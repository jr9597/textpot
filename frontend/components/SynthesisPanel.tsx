"use client";

interface Props {
  synthesis: string;
  isLoading: boolean;
  contributingSources: string[]; // flag emojis
}

function SkeletonLoader() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-3.5 bg-gray-200 rounded-full w-full" />
      <div className="h-3.5 bg-gray-200 rounded-full w-[90%]" />
      <div className="h-3.5 bg-gray-200 rounded-full w-[75%]" />
    </div>
  );
}

export default function SynthesisPanel({
  synthesis,
  isLoading,
  contributingSources,
}: Props) {
  return (
    <div className="w-full rounded-xl border border-gray-200 bg-[#f9fafb] px-5 py-4 animate-fade-in">
      {/* Label */}
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
        AI Synthesis
      </p>

      {/* Content or skeleton */}
      {isLoading ? (
        <SkeletonLoader />
      ) : (
        <p className="text-[15px] text-gray-700 leading-relaxed">{synthesis}</p>
      )}

      {/* Contributing source flags */}
      {contributingSources.length > 0 && (
        <div className="flex gap-1.5 mt-4">
          {contributingSources.map((flag, i) => (
            <span
              key={i}
              className="text-lg px-1 rounded bg-white border border-gray-100 shadow-sm"
            >
              {flag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
