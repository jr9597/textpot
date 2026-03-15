"use client";

import { SourceResult } from "@/types";
import ResultCard from "./ResultCard";
import ForumResult from "./ForumResult";

interface Props {
  results: Record<string, SourceResult>;
}

const CONTENT_TYPE_BADGE: Record<string, string> = {
  news_articles: "📰 News",
  blog_posts: "📝 Blogs",
  forum_comments: "💬 Discussion",
};

export default function Dashboard({ results }: Props) {
  const entries = Object.entries(results);

  if (entries.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {entries.map(([sourceId, sourceResult], index) => {
        const { data, flag, name } = sourceResult;
        const badge = CONTENT_TYPE_BADGE[data.content_type] ?? "📄 Content";
        const isForums = data.content_type === "forum_comments";

        return (
          <div
            key={sourceId}
            className="rounded-xl border border-gray-200 bg-white overflow-hidden animate-fade-in-up"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
              <span className="font-semibold text-sm text-gray-800">
                {flag} {name}
              </span>
              <span className="text-xs text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
                {badge}
              </span>
            </div>

            {/* Content */}
            <div className="p-4">
              {isForums ? (
                <ForumResult
                  sentiment={data.overall_sentiment}
                  quotes={data.representative_quotes}
                />
              ) : (
                <div className="space-y-3">
                  {data.results.map((item, i) => (
                    <ResultCard key={i} item={item} sourceName={name} />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
