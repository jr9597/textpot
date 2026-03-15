"""
FastAPI entry point for the Textpot backend.

Exposes a single WebSocket endpoint at /ws that handles two message types:
  - "search": triggers parallel Computer Use agents across selected sources
  - "chat": answers follow-up questions about research results

The backend is fully stateless — no database, no session storage.
All context (results, conversation history) is passed by the frontend
on each request.
"""

import json
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import agent
import chat

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Textpot Backend")

# Allow all origins — frontend can be on any Vercel URL or localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint for Cloud Run readiness probes."""
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Main WebSocket endpoint.

    Accepts JSON messages from the frontend and routes them:
      - type "search" → agent.run() to start parallel browser agents
      - type "chat"   → chat.respond() to answer follow-up questions

    The connection stays open for the duration of a search session.
    Each new search resets state on the frontend; the backend is stateless.
    """
    await websocket.accept()
    api_key = os.getenv("GEMINI_API_KEY", "")
    logger.info("WebSocket client connected")

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = message.get("type")

            if msg_type == "search":
                query = message.get("query", "")
                sources = message.get("sources", [])
                logger.info("Search request: query=%r, sources=%s", query, sources)
                await agent.run(query, sources, websocket)

            elif msg_type == "chat":
                user_message = message.get("message", "")
                results = message.get("results", {})
                history = message.get("history", [])
                logger.info("Chat request: message=%r", user_message)
                await chat.respond(
                    message=user_message,
                    results=results,
                    history=history,
                    websocket=websocket,
                    api_key=api_key,
                )

            else:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Unknown message type: {msg_type}",
                })

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.exception("Unexpected WebSocket error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
