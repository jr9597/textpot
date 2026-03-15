"""
Chat module — handles follow-up questions about research results.

Uses gemini-2.0-flash for chat because it is fast, cost-effective,
and well-suited for conversational reasoning over structured JSON context.
The full results data and conversation history are included in every
request so Gemini can answer specific questions about findings.
"""

import json
import logging
from typing import Any

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# Chat uses the lighter text model — no vision or browser control needed.
CHAT_MODEL = "gemini-2.0-flash"


async def respond(
    message: str,
    results: dict,
    history: list[dict],
    websocket: Any,
    api_key: str,
) -> None:
    """
    Generate a chat response grounded in the research results.

    Builds a full context prompt containing: the research data, conversation
    history, and the new user message. Sends the response back over WebSocket.

    Args:
        message: The user's new chat message.
        results: Dict of source_id → structured result data from the search.
        history: Conversation history as [{role, content}] pairs.
        websocket: FastAPI WebSocket to stream the response to.
        api_key: Google AI Studio API key.
    """
    client = genai.Client(api_key=api_key)

    results_json = json.dumps(results, ensure_ascii=False, indent=2)

    # Build the conversation as Gemini Content objects so history is preserved.
    contents: list[types.Content] = []

    # System context as the first user turn — includes full results data.
    system_context = f"""You are a research assistant helping a user understand multilingual research results.

The user searched for information across multiple platforms and received the following structured results:

{results_json}

Use these results to answer the user's questions specifically and accurately.
Reference specific platforms, quotes, and data points when relevant.
Keep responses concise and informative."""

    contents.append(
        types.Content(
            role="user",
            parts=[types.Part(text=system_context)],
        )
    )
    contents.append(
        types.Content(
            role="model",
            parts=[types.Part(text="Understood. I have the research results and am ready to answer questions about them.")],
        )
    )

    # Replay conversation history so Gemini has full context.
    for turn in history:
        role = turn.get("role", "user")
        content = turn.get("content", "")
        # Gemini uses "model" not "assistant".
        gemini_role = "model" if role == "assistant" else "user"
        contents.append(
            types.Content(
                role=gemini_role,
                parts=[types.Part(text=content)],
            )
        )

    # Append the new user message.
    contents.append(
        types.Content(
            role="user",
            parts=[types.Part(text=message)],
        )
    )

    try:
        response = client.models.generate_content(
            model=CHAT_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                temperature=0.5,
            ),
        )
        reply = response.text.strip()
    except Exception as e:
        logger.error("Chat API call failed: %s", e)
        reply = f"Sorry, I encountered an error: {e}"

    await websocket.send_json({"type": "chat_response", "content": reply})
