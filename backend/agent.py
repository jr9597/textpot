"""
Orchestration layer — runs all Computer Use agents in parallel and
coordinates results collection, synthesis, and frontend streaming.

Parallel execution via asyncio.gather is critical for latency: running
4 browser agents sequentially would take 4x as long. With gather, all
sources browse simultaneously and results appear as each one finishes.
"""

import asyncio
import logging
import os
from typing import Any

from computer_use import run_computer_use_agent
from sources import SOURCES, SourceConfig
from synthesize import synthesize
from translate import translate_query

logger = logging.getLogger(__name__)


async def run(query: str, source_ids: list[str], websocket: Any) -> None:
    """
    Orchestrate parallel Computer Use agents for all selected sources.

    Immediately notifies the frontend that each source is loading,
    then spins up one agent per source concurrently. After all agents
    complete (or fail), synthesizes the collected results and signals
    completion to the frontend.

    Args:
        query: The user's research query.
        source_ids: List of source IDs to search (e.g. ["naver", "baidu"]).
        websocket: FastAPI WebSocket for streaming all messages.
    """
    api_key = os.getenv("GEMINI_API_KEY", "")

    # Resolve source configs — skip any unknown IDs.
    selected_sources: list[SourceConfig] = [
        SOURCES[sid] for sid in source_ids if sid in SOURCES
    ]

    if not selected_sources:
        await websocket.send_json({"type": "error", "message": "No valid sources selected."})
        await websocket.send_json({"type": "complete"})
        return

    # Immediately inform the frontend that all sources are starting.
    for source in selected_sources:
        await websocket.send_json({
            "type": "status",
            "source": source.id,
            "status": "loading",
        })

    # Translate the query into each unique language in parallel before
    # launching agents. This ensures search URLs use native-language terms
    # (e.g. "テスラ" on Yahoo Japan, "테슬라" on Naver) rather than English.
    unique_languages = {s.language for s in selected_sources}
    translations = await asyncio.gather(*[
        translate_query(query, lang, api_key)
        for lang in unique_languages
    ])
    translated: dict[str, str] = dict(zip(unique_languages, translations))
    logger.info("Translations: %s", translated)

    # Collect results as agents complete — keyed by source_id.
    collected_results: dict[str, dict] = {}

    async def handle_result(msg: dict) -> None:
        """Callback invoked by each agent when it produces results."""
        if msg.get("type") == "results":
            collected_results[msg["source"]] = msg["data"]
        # Forward all messages (results, screenshots, status) to the frontend.
        await websocket.send_json(msg)

    # Run all Computer Use agents in parallel. return_exceptions=True ensures
    # a single agent failure does not cancel the others — each source is
    # independent and we want as many results as possible.
    tasks = [
        run_computer_use_agent(
            source=source,
            query=translated.get(source.language, query),
            websocket=websocket,
            results_callback=handle_result,
            api_key=api_key,
        )
        for source in selected_sources
    ]

    outcomes = await asyncio.gather(*tasks, return_exceptions=True)

    # Log which sources succeeded and which failed.
    for source, outcome in zip(selected_sources, outcomes):
        if isinstance(outcome, Exception):
            logger.error("Source %s failed with: %s", source.id, outcome)
            await websocket.send_json({
                "type": "status",
                "source": source.id,
                "status": "error",
            })
        else:
            logger.info("Source %s completed successfully", source.id)

    # Only synthesize if at least one source returned usable results.
    if collected_results:
        try:
            synthesis_text = synthesize(query, collected_results, api_key)
            await websocket.send_json({"type": "synthesis", "content": synthesis_text})
        except Exception as e:
            logger.error("Synthesis failed: %s", e)
    else:
        logger.warning("No results collected from any source — skipping synthesis")

    await websocket.send_json({"type": "complete"})
