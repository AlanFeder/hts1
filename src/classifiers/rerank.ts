import { embedQuery, embedCost, generateText } from "../services/vertex.js";
import type { VectorStore } from "../services/vectorStore.js";
import type { ClassifyResponse } from "../types.js";

const DEFAULT_CANDIDATE_POOL = 20;

const RERANK_PROMPT = `You are an HTS (Harmonized Tariff Schedule) tariff classification expert.

Product to classify: "{description}"

Below are candidate HTS codes retrieved by semantic search. Rerank them from most to least relevant.

Candidates:
{options}

Return ONLY a JSON array of the line numbers (1-indexed) in order of relevance, best match first.
Include all {n} candidates. Example: [3, 1, 7, 2, ...]`;

export class RerankClassifier {
  constructor(
    private store: VectorStore,
    private defaultPool: number = DEFAULT_CANDIDATE_POOL
  ) {}

  async classify(
    description: string,
    topK: number = 5,
    candidatePool: number | null = null
  ): Promise<ClassifyResponse> {
    const pool = candidatePool ?? this.defaultPool;
    console.info(`rerank | query=${JSON.stringify(description)} top_k=${topK} candidate_pool=${pool}`);

    // Step 1: embedding retrieval
    const embedding = await embedQuery(description);
    const candidates = await this.store.query(embedding, pool);
    console.info(`rerank | retrieved ${candidates.length} candidates from vector store`);

    for (const c of candidates) {
      console.debug(`rerank | initial score=${c.score.toFixed(4)} hts=${c.hts_code} desc=${JSON.stringify(c.description)}`);
    }

    const initialRanking = candidates.map((c, i) => ({
      rank: i + 1,
      hts_code: c.hts_code,
      description: c.description,
      score: c.score,
    }));

    // Step 2: LLM reranking
    const options = candidates
      .map((c, i) => `${i + 1}. [${c.hts_code}] ${c.description} (path: ${c.path.slice(-2).join(" > ")})`)
      .join("\n");

    const rerankResult = await generateText(
      RERANK_PROMPT
        .replace("{description}", description)
        .replace("{options}", options)
        .replace("{n}", String(candidates.length))
    );

    console.debug(
      `rerank | LLM rerank response: ${rerankResult.text} tokens=${rerankResult.inputTokens}+${rerankResult.outputTokens} cost=$${rerankResult.costUsd.toFixed(6)}`
    );

    // Parse reranked order
    let rerankedIndices: number[] = [];
    const match = rerankResult.text.match(/\[[\s\S]*?\]/);
    if (match) {
      try {
        rerankedIndices = (JSON.parse(match[0]) as number[]).map(Number);
      } catch {
        console.warn("rerank | failed to parse LLM reranking response, using original order");
      }
    }

    // Fall back to original order for any missing indices
    const seen = new Set(rerankedIndices);
    for (let i = 1; i <= candidates.length; i++) {
      if (!seen.has(i)) rerankedIndices.push(i);
    }

    const reranked = rerankedIndices
      .filter((i) => i >= 1 && i <= candidates.length)
      .map((i) => candidates[i - 1]!)
      .slice(0, topK);

    console.info(`rerank | final order: ${reranked.map((r) => r.hts_code).join(", ")}`);

    return {
      results: reranked.map((r, rank) => ({
        hts_code: r.hts_code,
        description: r.description,
        path: r.path,
        score: 1.0 / (rank + 1),
        general_rate: r.general_rate || null,
      })),
      method: "rerank",
      query: description,
      cost_usd: embedCost([description]) + rerankResult.costUsd,
      intermediates: {
        candidate_pool: pool,
        initial_ranking: initialRanking,
        llm_raw_response: rerankResult.text,
        reranked_ranking: reranked.map((r, i) => ({
          rank: i + 1,
          hts_code: r.hts_code,
          description: r.description,
          original_score: r.score,
        })),
      },
    };
  }
}
