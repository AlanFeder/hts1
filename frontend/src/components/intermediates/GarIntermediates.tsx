import { useState } from "react";
import type { GarIntermediates } from "../../types";

const TERM_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-purple-100 text-purple-800 border-purple-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
];

export default function GarIntermediatesPanel({
  data,
}: {
  data: GarIntermediates;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const maxScore = Math.max(...data.bm25_scores.map((s) => s.raw_score), 0.001);

  return (
    <div className="space-y-5">
      {/* Expanded terms */}
      <div>
        <p className="section-label mb-2">
          LLM-Expanded Search Terms ({data.expanded_terms.length})
        </p>
        <div className="flex flex-wrap gap-2">
          {data.expanded_terms.map((term, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border ${
                TERM_COLORS[i % TERM_COLORS.length]
              }`}
            >
              {i === 0 && (
                <span className="font-bold text-[10px] uppercase opacity-60 mr-0.5">
                  orig
                </span>
              )}
              {term}
            </span>
          ))}
        </div>
      </div>

      {/* BM25 scores */}
      <div>
        <p className="section-label mb-3">BM25 Scores</p>
        <div className="space-y-2">
          {data.bm25_scores.map((s, i) => (
            <div key={s.hts_code + i} className="flex items-center gap-3">
              <span className="hts-badge flex-shrink-0 w-28 text-center">
                {s.hts_code}
              </span>
              <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${(s.raw_score / maxScore) * 100}%` }}
                />
              </div>
              <span className="font-mono text-xs text-slate-500 w-16 text-right flex-shrink-0">
                {s.normalized_score.toFixed(4)}
              </span>
              <span className="text-xs text-slate-500 flex-1 min-w-0 truncate">
                {s.description}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Raw LLM response */}
      <div>
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform ${showRaw ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          Raw LLM Response
        </button>
        {showRaw && (
          <pre className="mt-2 p-3 bg-slate-900 text-slate-200 text-xs rounded-lg overflow-x-auto font-mono leading-relaxed">
            {data.llm_raw_response}
          </pre>
        )}
      </div>
    </div>
  );
}
