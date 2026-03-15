"""
Core Computer Use agentic loop.

Loop structure: take screenshot → send to Gemini → receive function calls
→ execute each action on Playwright page → take new screenshot → send
FunctionResponse back to Gemini → repeat until Gemini returns text (JSON result).

Uses gemini-2.5-computer-use-preview-10-2025 — the dedicated Computer Use
model with ENVIRONMENT_BROWSER capability.
"""

import asyncio
import base64
import json
import logging
import re
from typing import Any, Callable

from google import genai
from google.genai import types
from playwright.async_api import async_playwright

from sources import SourceConfig

logger = logging.getLogger(__name__)

# Computer Use requires gemini-2.5-flash-preview — this is the only model
# with ENVIRONMENT_BROWSER support at time of writing.
COMPUTER_USE_MODEL = "gemini-2.5-computer-use-preview-10-2025"

# Hard cap on loop iterations to prevent runaway agents.
MAX_ITERATIONS = 15

# Viewport dimensions — keep consistent so coordinates are predictable.
VIEWPORT_WIDTH = 1280
VIEWPORT_HEIGHT = 800


async def run_computer_use_agent(
    source: SourceConfig,
    query: str,
    websocket: Any,
    results_callback: Callable,
    api_key: str,
) -> None:
    """
    Run a single Computer Use agent for one research source.

    Spawns a headless Chromium browser, navigates the source site, and lets
    Gemini autonomously browse and extract results via screenshot-based vision.
    Streams screenshots to the frontend in real time.

    Args:
        source: Source configuration (name, URL, task template).
        query: User research query.
        websocket: FastAPI WebSocket to stream messages to the frontend.
        results_callback: Async callable invoked when the agent produces results.
        api_key: Google AI Studio API key.
    """
    client = genai.Client(api_key=api_key)

    # Computer Use tool — ENVIRONMENT_BROWSER tells Gemini it is controlling
    # a web browser and should emit browser-appropriate actions.
    tool = types.Tool(
        computer_use=types.ComputerUse(
            environment=types.Environment.ENVIRONMENT_BROWSER,
        )
    )

    config = types.GenerateContentConfig(
        tools=[tool],
        system_instruction=(
            "You are a multilingual research agent that autonomously browses websites "
            "and extracts structured research data. Navigate the site, search for the "
            "requested topic, scroll through results, and when you have enough "
            "information return ONLY a valid JSON object as specified. "
            "Do not include any explanation or markdown — just raw JSON."
        ),
    )

    task = source.task_template.format(query=query)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT}
        )

        try:
            await page.goto(source.start_url, timeout=20000, wait_until="domcontentloaded")
        except Exception as e:
            # Some sites load slowly; continue anyway — the agent will see
            # whatever the page renders in the screenshot.
            logger.warning("Initial page load issue for %s: %s", source.id, e)

        # Initial screenshot to bootstrap the conversation.
        screenshot_bytes = await page.screenshot(type="png")
        await _send_screenshot(websocket, source.id, screenshot_bytes)

        # Build the initial conversation: task prompt + screenshot.
        contents: list[types.Content] = [
            types.Content(
                role="user",
                parts=[
                    types.Part(text=task),
                    types.Part.from_bytes(data=screenshot_bytes, mime_type="image/png"),
                ],
            )
        ]

        try:
            for iteration in range(MAX_ITERATIONS):
                try:
                    response = client.models.generate_content(
                        model=COMPUTER_USE_MODEL,
                        contents=contents,
                        config=config,
                    )
                except Exception as e:
                    logger.error("Gemini API error on %s iteration %d: %s", source.id, iteration, e)
                    break

                candidate = response.candidates[0]
                contents.append(candidate.content)

                # Collect all function calls from this response turn.
                function_calls = [
                    part.function_call
                    for part in candidate.content.parts
                    if part.function_call is not None
                ]

                if not function_calls:
                    # No function calls means Gemini is done browsing.
                    # Extract the JSON result from the text response.
                    text = _extract_text(candidate.content.parts)
                    data = _parse_json(text)

                    if data:
                        await results_callback({
                            "type": "results",
                            "source": source.id,
                            "data": data,
                            "flag": source.flag,
                            "language": source.language,
                            "name": source.name,
                        })
                    else:
                        logger.warning("Could not parse JSON from %s response: %s", source.id, text[:500])
                    break

                # Execute every function call Gemini requested, then send
                # the results (with a fresh screenshot) back as FunctionResponses.
                function_response_parts: list[types.Part] = []

                for fc in function_calls:
                    result = await _execute_action(page, fc.name, fc.args or {})
                    # Brief pause so the page can react to the action.
                    await asyncio.sleep(1)

                new_screenshot = await page.screenshot(type="png")
                await _send_screenshot(websocket, source.id, new_screenshot)

                # Build one FunctionResponse per call, embedding the new
                # screenshot so Gemini can see the result of its action.
                for fc in function_calls:
                    function_response_parts.append(
                        types.Part(
                            function_response=types.FunctionResponse(
                                id=getattr(fc, "id", None),
                                name=fc.name,
                                response={"result": "success", "url": page.url},
                            )
                        )
                    )

                # Append the screenshot as a separate part in the same user turn
                # so Gemini can see the current page state after all actions.
                function_response_parts.append(
                    types.Part.from_bytes(data=new_screenshot, mime_type="image/png")
                )

                contents.append(
                    types.Content(role="user", parts=function_response_parts)
                )

        except Exception as e:
            logger.exception("Unexpected error in Computer Use loop for %s: %s", source.id, e)
        finally:
            await browser.close()

    await websocket.send_json({"type": "status", "source": source.id, "status": "done"})


async def _execute_action(page: Any, name: str, args: dict) -> str:
    """
    Execute a single Computer Use function call on the Playwright page.

    Gemini emits predefined function call names for ENVIRONMENT_BROWSER.
    Each function maps to the corresponding Playwright API.

    Args:
        page: Active Playwright page.
        name: Computer Use function name (e.g. "computer_use_click").
        args: Function arguments dict from Gemini.

    Returns:
        "success" or an error description string.
    """
    try:
        if name == "computer_use_click":
            coord = args.get("coordinate", [640, 400])
            x, y = coord[0], coord[1]
            await page.mouse.click(x, y)

        elif name == "computer_use_type":
            text = args.get("text", "")
            await page.keyboard.type(text)

        elif name == "computer_use_key":
            key = args.get("key", "")
            await page.keyboard.press(key)

        elif name == "computer_use_scroll":
            coord = args.get("coordinate", [640, 400])
            await page.mouse.move(coord[0], coord[1])
            direction = args.get("direction", "down")
            amount = int(args.get("amount", 3))
            delta_x, delta_y = 0, 0
            if direction == "down":
                delta_y = amount * 120
            elif direction == "up":
                delta_y = -amount * 120
            elif direction == "right":
                delta_x = amount * 120
            elif direction == "left":
                delta_x = -amount * 120
            await page.mouse.wheel(delta_x, delta_y)

        elif name == "computer_use_screenshot":
            # No-op — a screenshot is always taken after every action set.
            pass

        else:
            logger.warning("Unknown Computer Use function: %s", name)
            return f"unknown function: {name}"

        return "success"

    except Exception as e:
        logger.error("Action %s failed: %s", name, e)
        return f"error: {e}"


async def _send_screenshot(websocket: Any, source_id: str, screenshot_bytes: bytes) -> None:
    """Encode screenshot as base64 and stream it to the frontend."""
    b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
    await websocket.send_json({
        "type": "screenshot",
        "source": source_id,
        "image": b64,
    })


def _extract_text(parts: list) -> str:
    """Concatenate all text parts from a Gemini response."""
    return "\n".join(
        part.text for part in parts if getattr(part, "text", None)
    )


def _parse_json(text: str) -> dict | None:
    """
    Extract and parse the first JSON object from Gemini's response text.

    Gemini sometimes wraps JSON in markdown code blocks; strip those first.
    """
    if not text:
        return None

    # Strip markdown code fences if present.
    text = re.sub(r"```(?:json)?\s*", "", text).strip()

    # Try direct parse first.
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Fall back to finding the first {...} block in the text.
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            logger.error("JSON parse failed. Raw text: %s", text[:1000])

    return None
