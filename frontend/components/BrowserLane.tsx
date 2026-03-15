"use client";

import { SourceStatus } from "@/types";

const SOURCE_META: Record<string, { label: string; flag: string }> = {
  naver: { label: "Naver", flag: "🇰🇷" },
  yahoo_japan: { label: "Yahoo Japan", flag: "🇯🇵" },
  baidu: { label: "Baidu", flag: "🇨🇳" },
  dcard: { label: "Dcard", flag: "🇹🇼" },
  seznam: { label: "Seznam", flag: "🇨🇿" },
  reddit: { label: "Reddit", flag: "🟠" },
  threads: { label: "Threads", flag: "🧵" },
};

interface Props {
  sourceId: string;
  screenshot: string | null;
  status: SourceStatus;
}

function StatusIndicator({ status }: { status: SourceStatus }) {
  if (status === "loading") {
    return (
      <span className="inline-block w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
    );
  }
  if (status === "done") {
    return <span className="text-green-500 text-sm">✓</span>;
  }
  return <span className="text-red-400 text-sm">✕</span>;
}

export default function BrowserLane({ sourceId, screenshot, status }: Props) {
  const meta = SOURCE_META[sourceId] ?? { label: sourceId, flag: "🌐" };

  return (
    <div className="flex-shrink-0 w-[280px] rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
        <span className="text-sm font-medium text-gray-700">
          {meta.flag} {meta.label}
        </span>
        <StatusIndicator status={status} />
      </div>

      {/* Screenshot panel */}
      <div className="w-full h-[175px] bg-gray-100 flex items-center justify-center overflow-hidden">
        {screenshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/png;base64,${screenshot}`}
            alt={`${meta.label} browser screenshot`}
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-gray-400">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">Connecting...</span>
          </div>
        )}
      </div>
    </div>
  );
}
