"""
FastAPI backend for the Textpot Chrome extension.

Exposes REST endpoints called by the extension's background service worker:
  POST /translate        — translate query into target language
  POST /computer-use-step — one turn of the Gemini Computer Use loop
  POST /synthesize       — cross-platform journalistic synthesis
  POST /chat             — follow-up chat grounded in research results
"""

import base64
import json
import logging
import os
import re
import uuid
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types

import chat
import synthesize as synthesize_module
import translate as translate_module

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Textpot Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


class TranslateRequest(BaseModel):
    query: str
    language: str


class SynthesizeRequest(BaseModel):
    query: str
    results: dict


class ChatRequest(BaseModel):
    message: str
    results: dict
    history: list[dict] = []


class ComputerUseStepRequest(BaseModel):
    # First call: session_id=None, task and screenshot_b64 required.
    # Subsequent calls: session_id required, action_results + screenshot_b64 required.
    session_id: Optional[str] = None
    task: Optional[str] = None
    screenshot_b64: str
    action_results: Optional[list[dict]] = None  # [{id, name, result, url}]


COMPUTER_USE_MODEL = "gemini-2.5-computer-use-preview-10-2025"

# In-memory session store: session_id → {contents, last_fcs}
# Avoids serialising/deserialising SDK types across requests.
_cu_sessions: dict[str, dict[str, Any]] = {}

_CU_TOOL = types.Tool(
    computer_use=types.ComputerUse(environment=types.Environment.ENVIRONMENT_BROWSER)
)
_CU_CONFIG = types.GenerateContentConfig(
    tools=[_CU_TOOL],
    system_instruction=(
        "You are a multilingual research agent that browses websites and extracts "
        "structured data. When you have gathered enough information, return ONLY a "
        "valid JSON object — no markdown fences, no explanation."
    ),
)


@app.post("/translate")
async def translate_endpoint(req: TranslateRequest):
    api_key = os.getenv("GEMINI_API_KEY", "")
    translated = await translate_module.translate_query(req.query, req.language, api_key)
    return {"translated": translated}


@app.post("/synthesize")
def synthesize_endpoint(req: SynthesizeRequest):
    api_key = os.getenv("GEMINI_API_KEY", "")
    content = synthesize_module.synthesize(req.query, req.results, api_key)
    return {"content": content}


@app.post("/chat")
def chat_endpoint(req: ChatRequest):
    api_key = os.getenv("GEMINI_API_KEY", "")
    reply = chat.respond_rest(
        message=req.message,
        results=req.results,
        history=req.history,
        api_key=api_key,
    )
    return {"content": reply}


@app.post("/computer-use-step")
async def computer_use_step_endpoint(req: ComputerUseStepRequest):
    """
    One iteration of the Gemini Computer Use loop.

    First call (session_id=None): initialises a server-side session with the
    task prompt + initial screenshot, calls Gemini, returns actions + session_id.

    Subsequent calls: looks up the session, appends function responses and the
    new screenshot, calls Gemini again. Session is deleted when done=True.

    Keeping state server-side avoids serialising/deserialising Gemini SDK types
    (FunctionCall, Content) across HTTP — the 400 INVALID_ARGUMENT error we saw
    when reconstructing FunctionCall objects from JSON.
    """
    api_key = os.getenv("GEMINI_API_KEY", "")
    client = genai.Client(api_key=api_key)
    screenshot_bytes = base64.b64decode(req.screenshot_b64)

    if req.session_id is None:
        # ── First turn: create session ────────────────────────────────────
        session_id = str(uuid.uuid4())
        contents: list[types.Content] = [
            types.Content(
                role="user",
                parts=[
                    types.Part(text=req.task or ""),
                    types.Part.from_bytes(data=screenshot_bytes, mime_type="image/png"),
                ],
            )
        ]
    else:
        # ── Subsequent turn: resume session ───────────────────────────────
        session_id = req.session_id
        session = _cu_sessions.get(session_id)
        if not session:
            logger.error("Session %s not found", session_id)
            return {"session_id": session_id, "actions": [], "done": True, "result_json": None}

        contents = session["contents"]
        last_fcs = session["last_fcs"]

        # Build function-response parts using the stored SDK FunctionCall objects
        # so ids and types stay correct.
        fr_parts: list[types.Part] = []
        for i, fc in enumerate(last_fcs):
            ar = (req.action_results or [])[i] if req.action_results and i < len(req.action_results) else {}
            fr_parts.append(types.Part(
                function_response=types.FunctionResponse(
                    id=getattr(fc, "id", None),
                    name=fc.name,
                    response={
                        "result": ar.get("result", "success"),
                        "url": ar.get("url", ""),
                        "safety_acknowledgement": True,
                    },
                )
            ))
        fr_parts.append(types.Part.from_bytes(data=screenshot_bytes, mime_type="image/png"))
        contents.append(types.Content(role="user", parts=fr_parts))

    # ── Call Gemini ───────────────────────────────────────────────────────
    try:
        response = client.models.generate_content(
            model=COMPUTER_USE_MODEL,
            contents=contents,
            config=_CU_CONFIG,
        )
    except Exception as e:
        logger.error("Computer use step failed (session=%s): %s", session_id, e)
        _cu_sessions.pop(session_id, None)
        return {"session_id": session_id, "actions": [], "done": True, "result_json": None}

    if not response or not response.candidates:
        _cu_sessions.pop(session_id, None)
        return {"session_id": session_id, "actions": [], "done": True, "result_json": None}

    candidate = response.candidates[0]
    if not candidate.content or not candidate.content.parts:
        _cu_sessions.pop(session_id, None)
        return {"session_id": session_id, "actions": [], "done": True, "result_json": None}

    function_calls = [
        p.function_call for p in candidate.content.parts if p.function_call is not None
    ]

    if not function_calls:
        # No more actions — Gemini returned the final JSON result
        text = "\n".join(p.text for p in candidate.content.parts if getattr(p, "text", None))
        _cu_sessions.pop(session_id, None)
        return {"session_id": session_id, "actions": [], "done": True, "result_json": _parse_json_text(text)}

    # Store the model's response content + raw FunctionCall SDK objects for next turn
    contents.append(candidate.content)
    _cu_sessions[session_id] = {"contents": contents, "last_fcs": function_calls}

    actions = [
        {"id": getattr(fc, "id", None), "name": fc.name, "args": dict(fc.args or {})}
        for fc in function_calls
    ]
    return {"session_id": session_id, "actions": actions, "done": False, "result_json": None}


def _parse_json_text(text: str):
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
            pass
    return None
