import { WSMessage } from "@/types";

export interface WSSession {
  send: (message: object) => void;
  close: () => void;
}

/**
 * Open a WebSocket connection to the backend and return a session handle.
 *
 * @param onMessage  Callback invoked with each parsed JSON message from the server.
 * @returns          Session object with `send` and `close` methods.
 */
export function createSession(onMessage: (msg: WSMessage) => void): WSSession {
  const url = process.env.NEXT_PUBLIC_BACKEND_WS_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_BACKEND_WS_URL is not set");
  }

  const ws = new WebSocket(url);
  const queue: object[] = [];

  ws.onopen = () => {
    console.log("[ws] connected");
    // Flush any messages that were sent before the connection opened.
    while (queue.length > 0) {
      ws.send(JSON.stringify(queue.shift()));
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg: WSMessage = JSON.parse(event.data);
      onMessage(msg);
    } catch (e) {
      console.error("[ws] failed to parse message:", event.data, e);
    }
  };

  ws.onerror = (err) => {
    console.error("[ws] error", err);
  };

  ws.onclose = () => {
    console.log("[ws] disconnected");
  };

  return {
    send: (message: object) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      } else {
        // Connection still opening — queue the message for onopen to flush.
        queue.push(message);
      }
    },
    close: () => {
      ws.close();
    },
  };
}
