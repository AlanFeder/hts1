import { embedQuery, embedCost, vecNorm } from "../services/vertex.js";
import type { VectorStore } from "../services/vectorStore.js";
import type { ClassifyResponse } from "../types.js";

export class EmbeddingsClassifier {
  constructor(
    private avgStore: VectorStore,
    private leafStore: VectorStore,
    private pathStore: VectorStore
  ) {}

  async classify(
    description: string,
    topK: number = 5,
    pathWeight: number | null = null
  ): Promise<ClassifyResponse> {
    console.info(`embeddings | query=${JSON.stringify(description)} top_k=${topK} path_weight=${pathWeight}`);

    const embedding = await embedQuery(description);
    const norm = vecNorm(embedding);
    console.debug(`embeddings | query embedding norm=${norm.toFixed(4)} dim=${embedding.length}`);

    let results: Awaited<ReturnType<VectorStore["query"]>>;
    let blendInfo: Record<string, unknown>;

    if (pathWeight === null) {
      results = await this.avgStore.query(embedding, topK);
      blendInfo = { mode: "avg" };
    } else {
      const pool = Math.max(topK * 4, 20);
      const [leafResults, pathResults] = await Promise.all([
        this.leafStore.query(embedding, pool),
        this.pathStore.query(embedding, pool),
      ]);

      const leafScores = new Map(leafResults.map((r) => [r.hts_code, r]));
      const pathScores = new Map(pathResults.map((r) => [r.hts_code, r]));

      const allCodes = new Set([...leafScores.keys(), ...pathScores.keys()]);
      const blended = [...allCodes].map((code) => {
        const ls = leafScores.get(code)?.score ?? 0;
        const ps = pathScores.get(code)?.score ?? 0;
        const entry = leafScores.get(code) ?? pathScores.get(code)!;
        return { ...entry, score: (1 - pathWeight) * ls + pathWeight * ps };
      });

      blended.sort((a, b) => b.score - a.score);
      results = blended.slice(0, topK);
      blendInfo = { mode: "weighted", path_weight: pathWeight };
    }

    for (const r of results) {
      console.info(`embeddings | score=${r.score.toFixed(4)} hts=${r.hts_code} desc=${JSON.stringify(r.description)}`);
    }

    return {
      results: results.map((r) => ({
        hts_code: r.hts_code,
        description: r.description,
        path: r.path,
        score: r.score,
        general_rate: r.general_rate || null,
      })),
      method: "embeddings",
      query: description,
      cost_usd: embedCost([description]),
      intermediates: {
        query_embedding_norm: norm,
        embedding_dim: embedding.length,
        ...blendInfo,
        raw_scores: results.map((r) => ({
          hts_code: r.hts_code,
          description: r.description,
          score: r.score,
        })),
      },
    };
  }
}
