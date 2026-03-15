"use client";

import { OverallSentiment } from "@/types";

interface Props {
  sentiment: OverallSentiment;
  quotes: string[];
}

function SentimentBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-600">
        <span>{label}</span>
        <span className="font-medium">{value}%</span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

const QUOTE_EMOJI = ["😊", "😐", "😠"];

export default function ForumResult({ sentiment, quotes }: Props) {
  return (
    <div className="space-y-4">
      {/* Sentiment bars */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Sentiment
        </p>
        <div className="space-y-2">
          <SentimentBar label="Positive" value={sentiment.positive} color="bg-emerald-400" />
          <SentimentBar label="Neutral" value={sentiment.neutral} color="bg-amber-400" />
          <SentimentBar label="Negative" value={sentiment.negative} color="bg-red-400" />
        </div>
      </div>

      <hr className="border-gray-100" />

      {/* Representative quotes */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Top comments
        </p>
        <div className="space-y-2">
          {quotes.slice(0, 3).map((quote, i) => (
            <p key={i} className="text-xs text-gray-700 italic leading-relaxed">
              {QUOTE_EMOJI[i] ?? "💬"} &ldquo;{quote}&rdquo;
            </p>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">Based on visible posts</p>
      </div>
    </div>
  );
}
