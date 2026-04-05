import { useState } from "react";
import type { ClassifyRequest, Method } from "../types";
import { METHOD_META } from "../types";

interface Props {
  onSubmit: (req: ClassifyRequest) => void;
  loading: boolean;
  defaultDescription?: string;
}

const METHODS: Method[] = ["embeddings", "gar", "rerank", "agentic"];

const METHOD_DESCRIPTIONS: Record<Method, string> = {
  embeddings:
    "Semantic vector search using pre-computed embeddings. Fast, no LLM call.",
  gar: "LLM generates alternative search phrases, then BM25 keyword scoring.",
  rerank:
    "Semantic retrieval followed by LLM reranking for precision. 1 LLM call.",
  agentic:
    "Layer-by-layer HTS tree traversal with LLM explore/finalize decisions. Multiple LLM calls.",
};

export default function ClassifyForm({ onSubmit, loading, defaultDescription = "" }: Props) {
  const [description, setDescription] = useState(defaultDescription);
  const [method, setMethod] = useState<Method>("embeddings");
  const [topK, setTopK] = useState(5);
  const [pathWeight, setPathWeight] = useState<string>("");
  const [candidatePool, setCandidatePool] = useState<string>("");
  const [beamWidth, setBeamWidth] = useState<string>("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    onSubmit({
      description: description.trim(),
      method,
      top_k: topK,
      path_weight: method === "embeddings" && pathWeight !== "" ? parseFloat(pathWeight) : null,
      candidate_pool: method === "rerank" && candidatePool !== "" ? parseInt(candidatePool) : null,
      beam_width: method === "agentic" && beamWidth !== "" ? parseInt(beamWidth) : null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Description */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
          Product Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. 16-inch MacBook Pro laptop computer with M3 chip"
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
      </div>

      {/* Method selector */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          Classification Method
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {METHODS.map((m) => {
            const meta = METHOD_META[m];
            const active = method === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`relative flex flex-col items-start p-3 rounded-lg border-2 text-left transition-all ${
                  active
                    ? `${meta.border} ${meta.bg} border-current`
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full mb-2 ${active ? meta.dot : "bg-slate-300"}`}
                />
                <span
                  className={`text-sm font-semibold ${active ? meta.color : "text-slate-700"}`}
                >
                  {meta.label}
                </span>
                <span className="text-xs text-slate-400 mt-0.5 leading-tight">
                  {METHOD_DESCRIPTIONS[m]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Advanced params row */}
      <div className="flex flex-wrap gap-4 items-end">
        <div className="w-24">
          <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">
            Top-K
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={topK}
            onChange={(e) => setTopK(parseInt(e.target.value) || 5)}
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {method === "embeddings" && (
          <div className="w-36">
            <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">
              Path Weight{" "}
              <span className="text-slate-400 normal-case font-normal">
                (0–1, blank=avg)
              </span>
            </label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={pathWeight}
              onChange={(e) => setPathWeight(e.target.value)}
              placeholder="null"
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {method === "rerank" && (
          <div className="w-36">
            <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">
              Candidate Pool{" "}
              <span className="text-slate-400 normal-case font-normal">
                (default 20)
              </span>
            </label>
            <input
              type="number"
              min={1}
              value={candidatePool}
              onChange={(e) => setCandidatePool(e.target.value)}
              placeholder="20"
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {method === "agentic" && (
          <div className="w-36">
            <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">
              Beam Width{" "}
              <span className="text-slate-400 normal-case font-normal">
                (default 3)
              </span>
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={beamWidth}
              onChange={(e) => setBeamWidth(e.target.value)}
              placeholder="3"
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !description.trim()}
          className="ml-auto flex items-center gap-2 px-6 py-2.5 bg-navy-700 text-white text-sm font-semibold rounded-lg hover:bg-navy-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <>
              <svg
                className="animate-spin w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Classifying…
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              Classify
            </>
          )}
        </button>
      </div>
    </form>
  );
}
