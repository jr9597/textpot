"""
Core Computer Use agentic loop.

Loop structure: take screenshot → send to Gemini → receive function calls
→ execute each action on Playwright page → track URL changes → take new
screenshot → send FunctionResponse back to Gemini → repeat until Gemini
returns text (JSON result).

URL capture strategy: Playwright tracks page.url after every action.
When the URL changes away from the search results page the agent has
clicked into a result — we record that URL. After the loop we inject
the captured URLs into the top results so links are 100% accurate.

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

MAX_ITERATIONS = 25  # extra headroom for click-through navigation

VIEWPORT_WIDTH = 1280
VIEWPORT_HEIGHT = 800

# Number of results the agent should click into for accurate URLs.
CLICK_THROUGH_COUNT = 3


async def run_computer_use_agent(
    source: SourceConfig,
    query: str,
    websocket: Any,
    results_callback: Callable,
    api_key: str,
) -> None:
    """
    Run a single Computer Use agent for one research source.

    The agent lands directly on the search results page, clicks into the top
    3 results to capture their URLs via Playwright's page.url, then reads
    each page for richer content before returning to extract remaining results
    from snippets.

    Args:
        source: Source configuration (name, URL, task template).
        query: Translated query in the source's language.
        websocket: FastAPI WebSocket to stream messages to the frontend.
        results_callback: Async callable invoked when the agent produces results.
        api_key: Google AI Studio API key.
    """
    client = genai.Client(api_key=api_key)

    tool = types.Tool(
        computer_use=types.ComputerUse(
            environment=types.Environment.ENVIRONMENT_BROWSER,
        )
    )

    config = types.GenerateContentConfig(
        tools=[tool],
        system_instruction=(
            "You are a multilingual research agent that autonomously browses websites "
            "and extracts structured research data. Click into individual results to "
            "read their full content, then return to the results page. "
            "When done, return ONLY a valid JSON object as specified — no markdown, no explanation."
        ),
    )

    task = source.task_template.format(query=query)
    search_url = _search_url(source.start_url, query)
    logger.info("Starting %s at: %s", source.id, search_url)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT}
        )

        try:
            await page.goto(search_url, timeout=25000, wait_until="domcontentloaded")
            await asyncio.sleep(2)
        except Exception as e:
            logger.warning("Initial page load issue for %s: %s", source.id, e)

        # Track every URL the agent navigates to that is NOT the search
        # results page. Each one is a result page the agent clicked into.
        # We capture them in order and inject into the final results JSON.
        result_urls: list[str] = []
        last_url = page.url

        screenshot_bytes = await page.screenshot(type="png")
        await _send_screenshot(websocket, source.id, screenshot_bytes)

        contents: list[types.Content] = [
            types.Content(
                role="user",
                parts=[
                    types.Part(text=task),
                    types.Part.from_bytes(data=screenshot_bytes, mime_type="image/png"),
                ],
            )
        ]

        data = None

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

                function_calls = [
                    part.function_call
                    for part in candidate.content.parts
                    if part.function_call is not None
                ]

                if not function_calls:
                    text = _extract_text(candidate.content.parts)
                    data = _parse_json(text)
                    if not data:
                        logger.warning("Could not parse JSON from %s: %s", source.id, text[:500])
                    break

                # Execute actions and track URL changes after each one.
                for fc in function_calls:
                    await _execute_action(page, fc.name, fc.args or {})
                    await asyncio.sleep(1)

                    # If the page navigated away from the search results URL,
                    # record it — this is a result page the agent clicked into.
                    current_url = page.url
                    if (
                        current_url != last_url
                        and current_url != search_url
                        and not current_url.startswith(search_url)
                        and current_url not in result_urls
                        and len(result_urls) < CLICK_THROUGH_COUNT
                    ):
                        result_urls.append(current_url)
                        logger.info("%s captured result URL %d: %s", source.id, len(result_urls), current_url)
                    last_url = current_url

                new_screenshot = await page.screenshot(type="png")
                await _send_screenshot(websocket, source.id, new_screenshot)

                function_response_parts: list[types.Part] = []
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

        # Inject captured URLs into the top results.
        # The agent clicked results in order, so result_urls[0] belongs to
        # results[0], result_urls[1] to results[1], etc.
        if data and result_urls:
            results_list = data.get("results", [])
            for i, url in enumerate(result_urls):
                if i < len(results_list):
                    results_list[i]["url"] = url
            logger.info("%s injected %d URLs into results", source.id, len(result_urls))

        if data:
            await results_callback({
                "type": "results",
                "source": source.id,
                "data": data,
                "flag": source.flag,
                "language": source.language,
                "name": source.name,
            })

    await websocket.send_json({"type": "status", "source": source.id, "status": "done"})


def _norm_x(x: float) -> int:
    return int(x / 1000 * VIEWPORT_WIDTH)


def _norm_y(y: float) -> int:
    return int(y / 1000 * VIEWPORT_HEIGHT)


async def _execute_action(page: Any, name: str, args: dict) -> str:
    """
    Execute a single Computer Use function call on the Playwright page.

    The gemini-2.5-computer-use model emits these function names:
      open_web_browser, navigate, click_at, type_text_at,
      key_combination, scroll, wait_5_seconds, screenshot, search
    """
    try:
        if name in ("open_web_browser", "navigate"):
            url = args.get("url", "")
            if url:
                await page.goto(url, timeout=15000, wait_until="domcontentloaded")

        elif name == "click_at":
            x = _norm_x(args.get("x", 500))
            y = _norm_y(args.get("y", 500))
            await page.mouse.click(x, y)
            # Wait for potential navigation after click.
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=5000)
            except Exception:
                pass

        elif name == "type_text_at":
            x = args.get("x")
            y = args.get("y")
            if x is not None and y is not None:
                await page.mouse.click(_norm_x(x), _norm_y(y))
            text = args.get("text", "")
            await page.keyboard.type(text)
            if args.get("press_enter_after", False):
                await page.keyboard.press("Enter")

        elif name == "key_combination":
            key = args.get("key", "")
            if key:
                await page.keyboard.press(key)

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

        elif name == "wait_5_seconds":
            await asyncio.sleep(3)

        elif name in ("screenshot", "computer_use_screenshot"):
            pass

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
    b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
    await websocket.send_json({
        "type": "screenshot",
        "source": source_id,
        "image": b64,
    })


def _extract_text(parts: list) -> str:
    return "\n".join(
        part.text for part in parts if getattr(part, "text", None)
    )


def _parse_json(text: str) -> dict | None:
    if not text:
        return None

    text = re.sub(r"```(?:json)?\s*", "", text).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            logger.error("JSON parse failed. Raw text: %s", text[:1000])

    return None
