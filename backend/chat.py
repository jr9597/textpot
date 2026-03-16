"""
Chat module — answers follow-up questions about research results.

Uses gemini-2.5-flash for fast, cost-effective conversational reasoning
over structured JSON context. Full results data and conversation history
are included in every request so Gemini can answer specific questions.
"""

import json
import logging
from typing import Any

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

CHAT_MODEL = "gemini-2.5-flash"


def respond_rest(
    message: str,
    results: dict,
    history: list[dict],
    api_key: str,
) -> str:
    """
    Generate a chat response grounded in research results.

    Args:
        message: The user's new chat message.
        results: Dict of source_id → structured result data from the search.
        history: Conversation history as [{role, content}] pairs.
        api_key: Google AI Studio API key.

    Returns:
        Reply string.
    """
    client = genai.Client(api_key=api_key)

    results_json = json.dumps(results, ensure_ascii=False, indent=2)

    contents: list[types.Content] = []

    system_context = f"""You are a research assistant helping a user understand multilingual research results.

The user searched for information across multiple platforms and received the following structured results:

{results_json}

Use these results to answer the user's questions specifically and accurately.
Reference specific platforms, quotes, and data points when relevant.
Keep responses concise and informative."""

    contents.append(
        types.Content(role="user", parts=[types.Part(text=system_context)])
    )
    contents.append(
        types.Content(
            role="model",
            parts=[types.Part(text="Understood. I have the research results and am ready to answer questions about them.")],
        )
    )

    for turn in history:
        role = turn.get("role", "user")
        content = turn.get("content", "")
        gemini_role = "model" if role == "assistant" else "user"
        contents.append(
            types.Content(role=gemini_role, parts=[types.Part(text=content)])
        )

    contents.append(
        types.Content(role="user", parts=[types.Part(text=message)])
    )

    try:
        response = client.models.generate_content(
            model=CHAT_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(temperature=0.5),
        )
        return response.text.strip()
    except Exception as e:
        logger.error("Chat API call failed: %s", e)
        return f"Sorry, I encountered an error: {e}"
