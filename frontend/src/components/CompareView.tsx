import { useState } from "react";
import { classify } from "../api";
import type { Method, MethodState } from "../types";
import { METHOD_META } from "../types";
import ResultsTable from "./ResultsTable";
import IntermediatesPanel from "./intermediates/IntermediatesPanel";

const METHODS: Method[] = ["embeddings", "rerank", "gar"];

export default function CompareView() {
  const [description, setDescription] = useState("");
  const [topK, setTopK] = useState(5);
  const [states, setStates] = useState<Record<Method, MethodState>>({
    embeddings: { status: "idle" },
    gar: { status: "idle" },
    rerank: { status: "idle" },
    agentic: { status: "idle" },
  });
  const [expanded, setExpanded] = useState<Method | null>(null);

  const anyLoading = METHODS.some((m) => states[m].status === "loading");
  const anyDone = METHODS.some((m) => states[m].status === "success" || states[m].status === "error");

  function setMethodState(method: Method, state: MethodState) {
    setStates((prev) => ({ ...prev, [method]: state }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim() || anyLoading) return;
    setExpanded(null);

    // Fire all methods in parallel
    METHODS.forEach((method) => {
      const startedAt = performance.now();
      setMethodState(method, { status: "loading", startedAt });
      classify({ description: description.trim(), method, top_k: topK, path_weight: method === "embeddings" ? 1 : null })
        .then((data) => {
          const clientMs = performance.now() - startedAt;
          setMethodState(method, { status: "success", data, clientMs });
        })
        .catch((err) => {
          setMethodState(method, {
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        });
    });
  }

  const successStates = METHODS.map((m) => states[m]).filter(
    (s): s is Extract<MethodState, { status: "success" }> =>
      s.status === "success",
  );

  const maxMs = Math.max(
    ...successStates.map((s) => s.data.elapsed_ms ?? s.clientMs),
    1,
  );
  const maxCost = Math.max(
    ...successStates.map((s) => s.data.cost_usd ?? 0),
    0.000001,
  );

  return (
    <div className="space-y-6">
      {/* Input form */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-4">
          Compare All Methods
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. 16-inch MacBook Pro laptop computer with M3 chip"
            rows={2}
            className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          />
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Top-K
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={topK}
                onChange={(e) => setTopK(parseInt(e.target.value) || 5)}
                className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={anyLoading || !description.trim()}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-navy-700 text-white text-sm font-semibold rounded-lg hover:bg-navy-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {anyLoading ? (
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
                  Running…
                </>
              ) : (
                "Run All"
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Summary comparison table */}
      {anyDone && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">
            Summary Comparison
          </h3>

          {/* Performance bars */}
          <div className="space-y-3 mb-6">
            {METHODS.map((method) => {
              const s = states[method];
              const meta = METHOD_META[method];
              const ms =
                s.status === "success"
                  ? (s.data.elapsed_ms ?? s.clientMs)
                  : null;
              const cost = s.status === "success" ? (s.data.cost_usd ?? 0) : null;

              return (
                <div key={method} className="grid grid-cols-[120px_1fr_1fr] gap-4 items-center">
                  <span
                    className={`text-xs font-semibold flex items-center gap-1.5 ${meta.color}`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`}
                    />
                    {meta.label}
                  </span>

                  {/* Time bar */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        {s.status === "loading" ? (
                          <div className="h-full bg-slate-300 rounded-full animate-pulse w-full" />
                        ) : ms != null ? (
                          <div
                            className={`h-full rounded-full ${meta.dot}`}
                            style={{ width: `${(ms / maxMs) * 100}%` }}
                          />
                        ) : null}
                      </div>
                      <span className="font-mono text-xs text-slate-500 w-20 text-right flex-shrink-0">
                        {s.status === "loading"
                          ? "…"
                          : ms != null
                            ? `${ms.toFixed(0)} ms`
                            : s.status === "error"
                              ? "error"
                              : "—"}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">
                      Elapsed
                    </p>
                  </div>

                  {/* Cost bar */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        {s.status === "loading" ? (
                          <div className="h-full bg-slate-300 rounded-full animate-pulse w-full" />
                        ) : cost != null ? (
                          <div
                            className="h-full bg-gold-500 rounded-full"
                            style={{
                              width: `${Math.min((cost / maxCost) * 100, 100)}%`,
                            }}
                          />
                        ) : null}
                      </div>
                      <span className="font-mono text-xs text-slate-500 w-20 text-right flex-shrink-0">
                        {s.status === "loading"
                          ? "…"
                          : cost != null
                            ? cost === 0
                              ? "$0"
                              : `$${cost.toFixed(6)}`
                            : "—"}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">
                      Cost (USD)
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Top result comparison table */}
          <p className="section-label mb-3">Top Result per Method</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Method
                  </th>
                  <th className="text-left pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    HTS Code
                  </th>
                  <th className="text-left pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Description
                  </th>
                  <th className="text-right pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {METHODS.map((method) => {
                  const s = states[method];
                  const meta = METHOD_META[method];
                  const top =
                    s.status === "success" ? s.data.results[0] : null;

                  return (
                    <tr key={method} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-4">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.color}`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${meta.dot}`}
                          />
                          {meta.label}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        {s.status === "loading" ? (
                          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
                        ) : top ? (
                          <a href={`https://hts.usitc.gov/search?query=${top.hts_code}`} target="_blank" rel="noopener noreferrer" className="hts-badge hover:opacity-80 transition-opacity">{top.hts_code}</a>
                        ) : s.status === "error" ? (
                          <span className="text-xs text-red-500">Error</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-700">
                        {s.status === "loading" ? (
                          <div className="h-4 w-48 bg-slate-200 rounded animate-pulse" />
                        ) : (
                          top?.description ?? ""
                        )}
                      </td>
                      <td className="py-2.5 text-right font-mono text-xs text-slate-500">
                        {top ? top.score.toFixed(3) : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-method expandable result cards */}
      {anyDone && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {METHODS.map((method) => {
            const s = states[method];
            const meta = METHOD_META[method];
            const isOpen = expanded === method;

            return (
              <div
                key={method}
                className={`card border-2 ${meta.border} overflow-hidden`}
              >
                {/* Card header */}
                <div
                  className={`flex items-center gap-3 px-5 py-3.5 ${meta.bg} cursor-pointer`}
                  onClick={() =>
                    s.status === "success"
                      ? setExpanded(isOpen ? null : method)
                      : undefined
                  }
                >
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${meta.dot}`} />
                  <span className={`text-sm font-bold ${meta.color}`}>
                    {meta.label}
                  </span>

                  {s.status === "loading" && (
                    <svg
                      className="ml-auto animate-spin w-4 h-4 text-slate-400"
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
                  )}
                  {s.status === "success" && (
                    <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
                      <span className="font-mono">
                        {(s.data.elapsed_ms ?? s.clientMs).toFixed(0)} ms
                      </span>
                      {s.data.cost_usd != null && s.data.cost_usd > 0 && (
                        <span className="font-mono">
                          ${s.data.cost_usd.toFixed(6)}
                        </span>
                      )}
                      <svg
                        className={`w-4 h-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
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
                    </div>
                  )}
                  {s.status === "error" && (
                    <span className="ml-auto text-xs text-red-500">Failed</span>
                  )}
                </div>

                {/* Card body */}
                {s.status === "loading" && (
                  <div className="px-5 py-6 flex items-center justify-center">
                    <span className="text-sm text-slate-400 animate-pulse">
                      Classifying…
                    </span>
                  </div>
                )}
                {s.status === "error" && (
                  <div className="px-5 py-4">
                    <p className="text-xs text-red-600 font-mono">{s.message}</p>
                  </div>
                )}
                {s.status === "success" && (
                  <div className="px-5 py-4 space-y-4">
                    <ResultsTable response={s.data} compact />
                    {isOpen && (
                      <div className="pt-3 border-t border-slate-100">
                        <p className="section-label mb-3">Method Internals</p>
                        <IntermediatesPanel response={s.data} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
