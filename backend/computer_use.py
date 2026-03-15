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

from sources import SourceConfig, _search_url

logger = logging.getLogger(__name__)

COMPUTER_USE_MODEL = "gemini-2.5-computer-use-preview-10-2025"

# More iterations now that agents start on results pages (no search-box dance).
MAX_ITERATIONS = 20

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

    # Build the search-results URL directly so the agent lands on results
    # immediately — no iterations wasted finding and clicking a search box.
    search_url = _search_url(source.start_url, query)
    logger.info("Starting %s at: %s", source.id, search_url)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT}
        )

        try:
            await page.goto(search_url, timeout=25000, wait_until="domcontentloaded")
            # Extra settle time — dynamic sites need JS to finish rendering results.
            await asyncio.sleep(2)
        except Exception as e:
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

                # Build one FunctionResponse per call.
                # safety_acknowledgement=True is required — the model flags
                # certain actions (clicks, navigation) with a safety decision
                # that must be explicitly acknowledged or the next API call
                # returns 400 INVALID_ARGUMENT.
                for fc in function_calls:
                    function_response_parts.append(
                        types.Part(
                            function_response=types.FunctionResponse(
                                id=getattr(fc, "id", None),
                                name=fc.name,
                                response={
                                    "result": "success",
                                    "url": page.url,
                                    "safety_acknowledgement": True,
                                },
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


def _norm_x(x: float) -> int:
    """Convert 0-1000 normalised x coordinate to pixels."""
    return int(x / 1000 * VIEWPORT_WIDTH)


def _norm_y(y: float) -> int:
    """Convert 0-1000 normalised y coordinate to pixels."""
    return int(y / 1000 * VIEWPORT_HEIGHT)


async def _execute_action(page: Any, name: str, args: dict) -> str:
    """
    Execute a single Computer Use function call on the Playwright page.

    The gemini-2.5-computer-use model emits these actual function names
    (discovered from live logs — NOT the computer_use_* names in the docs):
      open_web_browser, navigate, click_at, type_text_at,
      key_combination, scroll, wait_5_seconds, screenshot, search

    Coordinates are on a 0-1000 scale normalised to the viewport.

    Args:
        page: Active Playwright page.
        name: Function name emitted by Gemini.
        args: Function arguments dict.

    Returns:
        "success" or an error description string.
    """
    try:
        # ── Navigation ──────────────────────────────────────────────────
        if name in ("open_web_browser", "navigate"):
            url = args.get("url", "")
            if url:
                await page.goto(url, timeout=15000, wait_until="domcontentloaded")

        # ── Click ────────────────────────────────────────────────────────
        elif name == "click_at":
            x = _norm_x(args.get("x", 500))
            y = _norm_y(args.get("y", 500))
            await page.mouse.click(x, y)

        # ── Type (with optional click first) ────────────────────────────
        elif name == "type_text_at":
            x = args.get("x")
            y = args.get("y")
            if x is not None and y is not None:
                await page.mouse.click(_norm_x(x), _norm_y(y))
            text = args.get("text", "")
            await page.keyboard.type(text)
            if args.get("press_enter_after", False):
                await page.keyboard.press("Enter")

        # ── Key combination (e.g. "Return", "ctrl+a") ───────────────────
        elif name == "key_combination":
            key = args.get("key", "")
            if key:
                await page.keyboard.press(key)

        # ── Scroll ───────────────────────────────────────────────────────
        elif name == "scroll":
            x = _norm_x(args.get("x", 500))
            y = _norm_y(args.get("y", 400))
            await page.mouse.move(x, y)
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

        # ── High-level search shortcut ───────────────────────────────────
        # Some iterations Gemini emits a "search" action. Best effort: focus
        # the first input on the page, clear it, type the query and submit.
        elif name == "search":
            query = args.get("query", args.get("text", ""))
            if query:
                try:
                    await page.focus("input[type=search], input[type=text], input:not([type])")
                    await page.keyboard.press("Control+a")
                    await page.keyboard.type(query)
                    await page.keyboard.press("Enter")
                except Exception:
                    pass

        # ── Wait ─────────────────────────────────────────────────────────
        elif name == "wait_5_seconds":
            await asyncio.sleep(3)  # cap at 3s to keep things moving

        # ── Screenshot — no-op, taken automatically after each turn ─────
        elif name in ("screenshot", "computer_use_screenshot"):
            pass

        # ── Legacy predefined names (kept for safety) ────────────────────
        elif name == "computer_use_click":
            coord = args.get("coordinate", [500, 400])
            await page.mouse.click(_norm_x(coord[0]), _norm_y(coord[1]))

        elif name == "computer_use_type":
            await page.keyboard.type(args.get("text", ""))

        elif name == "computer_use_key":
            await page.keyboard.press(args.get("key", ""))

        else:
            logger.warning("Unhandled Computer Use function: %s args=%s", name, args)
            return f"unhandled: {name}"

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
