import { useState } from "react";
import type { ClassifyRequest, Method } from "../types";
import { METHOD_META } from "../types";

interface Props {
  onSubmit: (req: ClassifyRequest) => void;
  loading: boolean;
  defaultDescription?: string;
}

const METHODS: Method[] = ["embeddings", "gar", "rerank", "agentic"];

const METHOD_SHORT: Record<Method, string> = {
  embeddings: "Vector similarity search",
  gar: "Keyword expansion + BM25",
  rerank: "Retrieve, then re-rank",
  agentic: "Tree traversal with LLM",
};

const METHOD_TOOLTIP: Record<Method, string> = {
  embeddings:
    "Converts your description into a numeric vector using Google's text-embedding-005 model, then finds the closest HTS entries by cosine similarity in a pre-built ChromaDB index.\n\nNo LLM call is made — this is the fastest and cheapest method. Results are best when your description uses trade-style language similar to HTS text. Adjust Path Weight (0–1) to blend leaf-description vs. full-path embeddings.",
  gar:
    "Sends your description to Gemini and asks it to generate 5 alternative HTS-style search phrases (e.g. \"iPhone\" → \"telephone sets for cellular networks\"). All phrases are combined and scored against HTS entries using BM25 keyword matching.\n\nBest when your description uses consumer or colloquial language that wouldn't appear verbatim in HTS text. One LLM call; moderate cost.",
  rerank:
    "First retrieves a broad pool of candidates (default: 20) via embedding similarity, then sends the full list to Gemini and asks it to re-rank them by relevance to your description.\n\nCombines the recall strength of vector search with the reasoning power of an LLM. The best single-call option for precision. One embedding call + one LLM call.",
  agentic:
    "Navigates the HTS hierarchy layer by layer: the LLM first picks which chapters to explore, then at each depth decides which nodes to explore further vs. finalize as results. Builds a complete audit trail of every branch considered.\n\nMost expensive and slowest (4–8 LLM calls, 10–30 seconds), but most interpretable. Use Beam Width to control how many branches are explored at each step.",
};

export default function ClassifyForm({ onSubmit, loading, defaultDescription = "" }: Props) {
  const [description, setDescription] = useState(defaultDescription);
  const [method, setMethod] = useState<Method>("embeddings");
  const [topK, setTopK] = useState(5);
  const [pathWeight, setPathWeight] = useState<string>("1");
  const [candidatePool, setCandidatePool] = useState<string>("");
  const [beamWidth, setBeamWidth] = useState<string>("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    onSubmit({
      description: description.trim(),
      method,
      top_k: topK,
      path_weight: method === "embeddings" ? parseFloat(pathWeight) : null,
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
                <div className="flex items-center gap-1 w-full">
                  <span
                    className={`text-sm font-semibold ${active ? meta.color : "text-slate-700"}`}
                  >
                    {meta.label}
                  </span>
                  {/* Info icon with hover tooltip */}
                  <span
                    className="relative ml-auto flex-shrink-0 group"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg
                      className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 cursor-help"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <circle cx="12" cy="12" r="10" strokeWidth="2" />
                      <path strokeLinecap="round" strokeWidth="2" d="M12 8v.01M12 12v4" />
                    </svg>
                    <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 hidden group-hover:block w-72">
                      <div className="bg-slate-900 text-slate-100 text-xs rounded-lg shadow-xl p-3 leading-relaxed whitespace-pre-line">
                        {METHOD_TOOLTIP[m]}
                      </div>
                      <div className="w-2 h-2 bg-slate-900 rotate-45 mx-auto -mt-1" />
                    </div>
                  </span>
                </div>
                <span className="text-xs text-slate-400 mt-0.5 leading-tight">
                  {METHOD_SHORT[m]}
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
          <div className="w-64">
            <div className="flex justify-between items-baseline mb-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Search by
              </label>
              <span className="text-xs font-mono text-blue-600 font-semibold">
                {pathWeight === "0"
                  ? "100% item description"
                  : pathWeight === "1"
                  ? "100% full path"
                  : `${Math.round((1 - parseFloat(pathWeight)) * 100)}% description · ${Math.round(parseFloat(pathWeight) * 100)}% path`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={pathWeight}
              onChange={(e) => setPathWeight(e.target.value)}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
              <span>Item description</span>
              <span>Full path</span>
            </div>
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
