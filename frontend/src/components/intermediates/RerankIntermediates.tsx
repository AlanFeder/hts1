import { useState } from "react";
import type { RerankIntermediates } from "../../types";

export default function RerankIntermediatesPanel({
  data,
}: {
  data: RerankIntermediates;
}) {
  const [showRaw, setShowRaw] = useState(false);

  // Build a map from hts_code to original rank for movement indicators
  const origRankMap = new Map(
    data.initial_ranking.map((r) => [r.hts_code, r.rank]),
  );

  return (
    <div className="space-y-5">
      <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 inline-block">
        <p className="section-label mb-1">Candidate Pool</p>
        <p className="font-mono text-sm font-semibold text-slate-800">
          {data.candidate_pool} candidates retrieved
        </p>
      </div>

      {/* Side-by-side rerank comparison */}
      <div>
        <p className="section-label mb-3">Ranking Comparison</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Initial */}
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-2">
              Initial (Embedding Score)
            </p>
            <div className="space-y-1.5">
              {data.initial_ranking.map((r) => (
                <div
                  key={r.hts_code}
                  className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200 text-xs"
                >
                  <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 font-semibold flex items-center justify-center flex-shrink-0">
                    {r.rank}
                  </span>
                  <a href={`https://hts.usitc.gov/search?query=${r.hts_code}`} target="_blank" rel="noopener noreferrer" className="hts-badge hover:opacity-80 transition-opacity">{r.hts_code}</a>
                  <span className="flex-1 min-w-0 truncate text-slate-600">
                    {r.description}
                  </span>
                  <span className="font-mono text-slate-400 flex-shrink-0">
                    {r.score.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Reranked */}
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-2">
              After LLM Rerank
            </p>
            <div className="space-y-1.5">
              {data.reranked_ranking.map((r) => {
                const origRank = origRankMap.get(r.hts_code);
                const moved =
                  origRank !== undefined ? origRank - r.rank : 0;
                return (
                  <div
                    key={r.hts_code}
                    className="flex items-center gap-2 p-2 rounded-lg bg-white border border-purple-200 text-xs"
                  >
                    <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 font-semibold flex items-center justify-center flex-shrink-0">
                      {r.rank}
                    </span>
                    <a href={`https://hts.usitc.gov/search?query=${r.hts_code}`} target="_blank" rel="noopener noreferrer" className="hts-badge hover:opacity-80 transition-opacity">{r.hts_code}</a>
                    <span className="flex-1 min-w-0 truncate text-slate-600">
                      {r.description}
                    </span>
                    {moved !== 0 && (
                      <span
                        className={`font-mono font-semibold flex-shrink-0 ${moved > 0 ? "text-emerald-600" : "text-red-500"}`}
                      >
                        {moved > 0 ? `▲${moved}` : `▼${Math.abs(moved)}`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
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
