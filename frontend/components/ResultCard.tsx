"use client";

import { useState } from "react";
import { ResultItem } from "@/types";

const SENTIMENT_EMOJI: Record<string, string> = {
  positive: "😊",
  neutral: "😐",
  negative: "😠",
};

interface Props {
  item: ResultItem;
  sourceName: string;
}

export default function ResultCard({ item, sourceName }: Props) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden hover:shadow-md transition-shadow">
      {/* Hero image — hidden if URL is absent or fails to load */}
      {item.image_url && !imgFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image_url}
          alt={item.title}
          onError={() => setImgFailed(true)}
          className="w-full h-[120px] object-cover"
        />
      )}

      <div className="p-3 space-y-1.5">
        {/* Sentiment badge */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">{sourceName}</span>
          <span className="text-xs">
            {SENTIMENT_EMOJI[item.sentiment] ?? ""}{" "}
            <span className="capitalize text-gray-500">{item.sentiment}</span>
          </span>
        </div>

        {/* Title */}
        <p className="text-sm font-medium text-gray-900 leading-snug whitespace-normal">
          {item.title}
        </p>

        {/* Summary */}
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
          {item.summary}
        </p>

        {/* Link */}
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs text-gray-400 hover:text-gray-700 transition-colors mt-1"
          >
            View original →
          </a>
        )}
      </div>
    </div>
  );
}
