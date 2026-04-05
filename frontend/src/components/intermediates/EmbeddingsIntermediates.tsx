import type { EmbeddingsIntermediates } from "../../types";

export default function EmbeddingsIntermediatesPanel({
  data,
}: {
  data: EmbeddingsIntermediates;
}) {
  const maxScore = Math.max(...data.raw_scores.map((r) => r.score), 0.001);

  return (
    <div className="space-y-5">
      {/* Embedding metadata */}
      <div className="grid grid-cols-3 gap-3">
        <StatBox label="Embedding Dim" value={String(data.embedding_dim)} />
        <StatBox
          label="Query Norm"
          value={data.query_embedding_norm.toFixed(4)}
        />
        <StatBox
          label="Mode"
          value={
            data.mode === "weighted"
              ? `Weighted (path_weight=${data.path_weight})`
              : "Avg collection"
          }
        />
      </div>

      {/* Score bars */}
      <div>
        <p className="section-label mb-3">Cosine Similarity Scores</p>
        <div className="space-y-2">
          {data.raw_scores.map((r, i) => (
            <div key={r.hts_code + i} className="flex items-center gap-3">
              <span className="hts-badge flex-shrink-0 w-28 text-center">
                {r.hts_code}
              </span>
              <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${(r.score / maxScore) * 100}%` }}
                />
              </div>
              <span className="font-mono text-xs text-slate-500 w-16 text-right flex-shrink-0">
                {r.score.toFixed(4)}
              </span>
              <span className="text-xs text-slate-500 flex-1 min-w-0 truncate">
                {r.description}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
      <p className="section-label mb-1">{label}</p>
      <p className="font-mono text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}
