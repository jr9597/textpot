"""
Query translation module.

Translates the user's search query into the target language before building
the search URL. This ensures each source receives a native-language query
rather than an English one, dramatically improving result relevance.

Uses gemini-2.5-flash because translation is a fast, cheap text task.
"""

import logging
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

TRANSLATION_MODEL = "gemini-2.5-flash"


async def translate_query(query: str, language: str, api_key: str) -> str:
    """
    Translate a search query into the target language.

    Args:
        query: Original English query from the user.
        language: Target language name (e.g. "Korean", "Japanese").
        api_key: Google AI Studio API key.

    Returns:
        Translated query string. Falls back to original query on error.
    """
    if language.lower() == "english":
        return query

    client = genai.Client(api_key=api_key)

    prompt = (
        f"Translate the following search query into {language}. "
        f"Return ONLY the translated text — no quotes, no explanation, nothing else.\n\n"
        f"Query: {query}"
    )

    try:
        response = await client.aio.models.generate_content(
            model=TRANSLATION_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.1),
        )
        translated = response.text.strip().strip('"').strip("'")
        logger.info("Translated '%s' → '%s' (%s)", query, translated, language)
        return translated
    except Exception as e:
        logger.error("Translation failed for %s: %s — using original query", language, e)
        return query
