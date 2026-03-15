"""
Synthesis module — calls gemini-2.0-flash to produce a cross-platform
journalistic summary once all Computer Use agents have returned results.

Uses gemini-2.0-flash (not the Computer Use model) because synthesis is
a pure text task that does not require vision or browser capabilities,
and gemini-2.0-flash is fast and cost-effective for this purpose.
"""

import json
import logging
import os

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# Synthesis does not need Computer Use, so use the lighter text model.
SYNTHESIS_MODEL = "gemini-2.5-flash"


def synthesize(query: str, results: dict[str, dict], api_key: str) -> str:
    """
    Generate a journalistic synthesis across all collected source results.

    Calls Gemini with a structured prompt containing all source data and
    asks for a 3-4 sentence summary that highlights cross-cultural differences
    and dominant sentiment patterns.

    Args:
        query: The original user research query.
        results: Dict mapping source_id to structured result data.
        api_key: Google AI Studio API key.

    Returns:
        Synthesis text as a plain string. Returns an error message on failure.
    """
    if not results:
        return "No results were collected from any source."

    client = genai.Client(api_key=api_key)

    # Serialize results so Gemini can reason over specific findings.
    results_json = json.dumps(results, ensure_ascii=False, indent=2)

    source_names = ", ".join(results.keys())

    prompt = f"""You are a multilingual research analyst. Below are structured research results
collected from {source_names} about the query: "{query}"

Results data:
{results_json}

Write a 3-4 sentence journalistic synthesis that:
1. States the dominant sentiment across all platforms (e.g. "Overall, reactions are mixed...")
2. Notes meaningful differences between countries or platforms — cite them by name
   (e.g. "On Naver...", "Weibo users...", "Yahoo Japan coverage...")
3. Highlights the most interesting, surprising, or culturally notable finding
4. Remains objective and fact-based

Return only the synthesis paragraph — no headers, no bullet points, no JSON."""

    try:
        response = client.models.generate_content(
            model=SYNTHESIS_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.4,
            ),
        )
        return response.text.strip()
    except Exception as e:
        logger.error("Synthesis API call failed: %s", e)
        return f"Synthesis unavailable: {e}"
