"use client";

import { FormEvent, useState } from "react";

const SOURCE_META: Record<string, { label: string; flag: string }> = {
  naver: { label: "Naver", flag: "🇰🇷" },
  yahoo_japan: { label: "Yahoo Japan", flag: "🇯🇵" },
  baidu: { label: "Baidu", flag: "🇨🇳" },
  dcard: { label: "Dcard", flag: "🇹🇼" },
  seznam: { label: "Seznam", flag: "🇨🇿" },
};

interface Props {
  onSearch: (query: string) => void;
  isSearching: boolean;
  selectedSources: string[];
  onToggleSource: (id: string) => void;
}

export default function SearchBar({
  onSearch,
  isSearching,
  selectedSources,
  onToggleSource,
}: Props) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isSearching) return;
    onSearch(query.trim());
  };

  const noneSelected = selectedSources.length === 0;

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-3xl mx-auto">
      {/* Query input + button */}
      <div className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any topic..."
          className="flex-1 px-4 py-3 text-base rounded-xl border border-gray-200 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-300 placeholder:text-gray-400"
        />
        <button
          type="submit"
          disabled={isSearching || noneSelected || !query.trim()}
          className="px-6 py-3 rounded-xl bg-gray-900 text-white text-sm font-medium shadow-sm hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isSearching ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Searching...
            </>
          ) : (
            "Search"
          )}
        </button>
      </div>

      {/* Source toggle pills */}
      <div className="flex gap-2 mt-3 flex-wrap">
        {Object.entries(SOURCE_META).map(([id, meta]) => {
          const active = selectedSources.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onToggleSource(id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {meta.flag} {meta.label}
            </button>
          );
        })}
        {noneSelected && (
          <span className="text-xs text-amber-600 self-center ml-1">
            Select at least one source
          </span>
        )}
      </div>
    </form>
  );
}
