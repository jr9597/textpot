"use client";

import { useCallback, useRef, useState } from "react";
import { createSession, WSSession } from "@/lib/websocket";
import {
  ChatMessage,
  ResultData,
  SourceResult,
  SourceStatus,
  WSMessage,
} from "@/types";

import SearchBar from "@/components/SearchBar";
import BrowserLane from "@/components/BrowserLane";
import SynthesisPanel from "@/components/SynthesisPanel";
import Dashboard from "@/components/Dashboard";
import ChatPanel from "@/components/ChatPanel";

type SearchStatus = "idle" | "searching" | "complete";

const ALL_SOURCES = ["naver", "yahoo_japan", "baidu", "dcard", "seznam"];

export default function Home() {
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [selectedSources, setSelectedSources] = useState<string[]>(ALL_SOURCES);

  // Per-source state
  const [screenshots, setScreenshots] = useState<Record<string, string>>({});
  const [sourceStatuses, setSourceStatuses] = useState<Record<string, SourceStatus>>({});
  const [results, setResults] = useState<Record<string, SourceResult>>({});

  // Synthesis
  const [synthesis, setSynthesis] = useState<string>("");

  // Chat
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([]);

  const sessionRef = useRef<WSSession | null>(null);

  const handleMessage = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      case "screenshot":
        setScreenshots((prev) => ({ ...prev, [msg.source]: msg.image }));
        break;

      case "status":
        setSourceStatuses((prev) => ({ ...prev, [msg.source]: msg.status }));
        break;

      case "results":
        setResults((prev) => ({
          ...prev,
          [msg.source]: {
            data: msg.data,
            flag: msg.flag,
            language: msg.language,
            name: msg.name,
          },
        }));
        break;

      case "synthesis":
        setSynthesis(msg.content);
        break;

      case "complete":
        setSearchStatus("complete");
        break;

      case "chat_response":
        setConversationHistory((prev) => [
          ...prev,
          { role: "assistant", content: msg.content },
        ]);
        break;

      case "error":
        console.error("[textpot] backend error:", msg.message);
        break;
    }
  }, []);

  const handleSearch = useCallback(
    (query: string) => {
      // Reset all state for a fresh search.
      setSearchStatus("searching");
      setScreenshots({});
      setSourceStatuses({});
      setResults({});
      setSynthesis("");
      setConversationHistory([]);

      // Close any existing session.
      sessionRef.current?.close();

      try {
        const session = createSession(handleMessage);
        sessionRef.current = session;

        session.send({
          type: "search",
          query,
          sources: selectedSources,
        });
      } catch (e) {
        console.error("Failed to open WebSocket:", e);
        setSearchStatus("idle");
      }
    },
    [selectedSources, handleMessage]
  );

  const handleChatSend = useCallback(
    (message: string) => {
      if (!sessionRef.current) return;

      const userMsg: ChatMessage = { role: "user", content: message };
      setConversationHistory((prev) => [...prev, userMsg]);

      sessionRef.current.send({
        type: "chat",
        message,
        results,
        history: conversationHistory,
      });
    },
    [results, conversationHistory]
  );

  const isSearching = searchStatus === "searching";
  const hasResults = Object.keys(results).length > 0;

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Textpot
          </h1>
          <p className="text-sm text-gray-500 italic">
            What the world actually thinks
          </p>
        </header>

        {/* Search bar */}
        <SearchBar
          onSearch={handleSearch}
          isSearching={isSearching}
          selectedSources={selectedSources}
          onToggleSource={(id) =>
            setSelectedSources((prev) =>
              prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
            )
          }
        />

        {/* Live browser lanes — visible only while searching */}
        {isSearching && (
          <div className="mt-8 flex gap-4 overflow-x-auto pb-2 animate-fade-in">
            {selectedSources.map((sourceId) => (
              <BrowserLane
                key={sourceId}
                sourceId={sourceId}
                screenshot={screenshots[sourceId] || null}
                status={sourceStatuses[sourceId] || "loading"}
              />
            ))}
          </div>
        )}

        {/* Synthesis panel */}
        {(synthesis || isSearching) && (
          <div className="mt-8">
            <SynthesisPanel
              synthesis={synthesis}
              isLoading={isSearching && !synthesis}
              contributingSources={Object.values(results).map((r) => r.flag)}
            />
          </div>
        )}

        {/* Results dashboard */}
        {hasResults && (
          <div className="mt-8">
            <Dashboard results={results} />
          </div>
        )}

        {/* Chat panel — shown only after search completes */}
        {searchStatus === "complete" && (
          <div className="mt-8">
            <ChatPanel
              history={conversationHistory}
              onSend={handleChatSend}
            />
          </div>
        )}
      </div>
    </main>
  );
}
