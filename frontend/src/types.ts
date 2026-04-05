export type Method = "embeddings" | "gar" | "agentic" | "rerank";

export interface HTSResult {
  hts_code: string;
  description: string;
  path: string[];
  score: number;
  general_rate: string | null;
}

export interface ClassifyRequest {
  description: string;
  method: Method;
  top_k?: number;
  path_weight?: number | null;
  candidate_pool?: number | null;
  beam_width?: number | null;
}

export interface ClassifyResponse {
  results: HTSResult[];
  method: string;
  query: string;
  cost_usd: number | null;
  elapsed_ms: number | null;
  intermediates: Record<string, unknown> | null;
}

// ── Typed intermediates ───────────────────────────────────────────────────────

export interface EmbeddingsIntermediates {
  query_embedding_norm: number;
  embedding_dim: number;
  mode: "avg" | "weighted";
  path_weight?: number;
  raw_scores: { hts_code: string; description: string; score: number }[];
}

export interface GarIntermediates {
  expanded_terms: string[];
  llm_raw_response: string;
  bm25_scores: {
    hts_code: string;
    description: string;
    raw_score: number;
    normalized_score: number;
  }[];
}

export interface RerankIntermediates {
  candidate_pool: number;
  initial_ranking: {
    rank: number;
    hts_code: string;
    description: string;
    score: number;
  }[];
  llm_raw_response: string;
  reranked_ranking: {
    rank: number;
    hts_code: string;
    description: string;
    original_score: number;
  }[];
}

export interface AgenticBeamStep {
  step: string;
  selected?: string[];
  llm_response: string;
  beam_size?: number;
  explored?: string[];
  finalized?: string[];
  pool_size?: number;
}

export interface AgenticIntermediates {
  beam_steps: AgenticBeamStep[];
}

// ── Compare state ─────────────────────────────────────────────────────────────

export type MethodState =
  | { status: "idle" }
  | { status: "loading"; startedAt: number }
  | { status: "success"; data: ClassifyResponse; clientMs: number }
  | { status: "error"; message: string };

export const METHOD_META: Record<
  Method,
  { label: string; color: string; bg: string; border: string; dot: string }
> = {
  embeddings: {
    label: "Embeddings",
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    dot: "bg-blue-500",
  },
  gar: {
    label: "GAR + BM25",
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  rerank: {
    label: "Rerank",
    color: "text-purple-700",
    bg: "bg-purple-50",
    border: "border-purple-200",
    dot: "bg-purple-500",
  },
  agentic: {
    label: "Agentic",
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
};
