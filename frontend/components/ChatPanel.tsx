"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { ChatMessage } from "@/types";

const SUGGESTED_QUESTIONS = [
  "Which platform was most negative?",
  "Summarize the Japanese perspective",
  "What surprised you most about these results?",
];

interface Props {
  history: ChatMessage[];
  onSend: (message: string) => void;
}

function TypingIndicator() {
  return (
    <div className="flex gap-1 items-center px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

export default function ChatPanel({ history, onSend }: Props) {
  const [input, setInput] = useState("");
  const [isWaiting, setIsWaiting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevHistoryLength = useRef(history.length);

  // Auto-scroll when new messages arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });

    // Detect when assistant response arrives and clear waiting state.
    if (history.length > prevHistoryLength.current) {
      const last = history[history.length - 1];
      if (last?.role === "assistant") {
        setIsWaiting(false);
      }
    }
    prevHistoryLength.current = history.length;
  }, [history]);

  const handleSend = (msg?: string) => {
    const text = msg ?? input.trim();
    if (!text || isWaiting) return;
    setInput("");
    setIsWaiting(true);
    onSend(text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasChatStarted = history.length > 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <p className="text-sm font-semibold text-gray-700">
          💬 Ask about these results
        </p>
      </div>

      {/* Message thread */}
      <div className="px-4 py-4 max-h-72 overflow-y-auto space-y-3">
        {/* Suggested starter questions — hide after first message */}
        {!hasChatStarted && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => handleSend(q)}
                className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Messages */}
        {history.map((msg, i) => {
          const isUser = msg.role === "user";
          return (
            <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  isUser
                    ? "bg-blue-100 text-gray-900 rounded-br-sm"
                    : "bg-gray-100 text-gray-800 rounded-bl-sm"
                }`}
              >
                {msg.content}
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {isWaiting && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm">
              <TypingIndicator />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="px-4 py-3 border-t border-gray-100 flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a follow-up question... (Enter to send)"
          disabled={isWaiting}
          rows={1}
          className="flex-1 resize-none px-3 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50 placeholder:text-gray-400"
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || isWaiting}
          className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
