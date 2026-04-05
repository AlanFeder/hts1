import { z } from "zod";

// ─── Request / Response schemas ───────────────────────────────────────────────

export const ClassifyRequestSchema = z.object({
  description: z.string().min(1),
  method: z.enum(["embeddings", "gar", "agentic", "rerank"]).default("embeddings"),
  top_k: z.number().int().positive().default(5),
  path_weight: z.number().min(0).max(1).nullable().default(null),
  candidate_pool: z.number().int().positive().nullable().default(null),
  beam_width: z.number().int().positive().nullable().default(null),
});

export type ClassifyRequest = z.infer<typeof ClassifyRequestSchema>;

export interface HTSResult {
  hts_code: string;
  description: string;
  path: string[];
  score: number;
  general_rate: string | null;
}

export interface ClassifyResponse {
  results: HTSResult[];
  method: string;
  query: string;
  cost_usd: number | null;
  intermediates: Record<string, unknown> | null;
}

// ─── Data model types ─────────────────────────────────────────────────────────

export interface HTSEntry {
  hts_code: string;
  description: string;
  indent: number;
  path: string[];
  path_string: string;
  general_rate: string;
}

export interface HTSNode {
  index: number;
  hts_code: string;
  description: string;
  indent: number;
  path: string[];
  general_rate: string;
  children: HTSNode[];
}

// chapter code (2-digit string) → top-level nodes in that chapter
export type ChapterMap = Map<string, HTSNode[]>;

// ─── Vertex AI result ─────────────────────────────────────────────────────────

export interface GenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
