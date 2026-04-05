import Fastify from "fastify";
import { existsSync } from "fs";
import { config } from "./config.js";
import { loadOrProcess } from "./data/processor.js";
import { VectorStore, COLLECTION_AVG, COLLECTION_LEAF, COLLECTION_PATH } from "./services/vectorStore.js";
import { EmbeddingsClassifier } from "./classifiers/embeddings.js";
import { GARClassifier } from "./classifiers/gar.js";
import { RerankClassifier } from "./classifiers/rerank.js";
import { AgenticClassifier } from "./classifiers/agentic.js";
import { ClassifyRequestSchema } from "./types.js";
import type { ClassifyRequest, ClassifyResponse } from "./types.js";

// ─── Parameter-to-method mapping (warn if mismatched) ─────────────────────────
const PARAM_METHODS: Record<string, string> = {
  path_weight: "embeddings",
  candidate_pool: "rerank",
  beam_width: "agentic",
};

function embeddingFiles(name: string): { bin: string; meta: string } {
  return {
    bin: `data/embeddings_${name}.bin`,
    meta: `data/embeddings_${name}_meta.json`,
  };
}

async function main() {
  const server = Fastify({ logger: false });

  // ─── Check exported embedding files ───────────────────────────────────────
  for (const name of [COLLECTION_AVG, COLLECTION_LEAF, COLLECTION_PATH]) {
    const { bin, meta } = embeddingFiles(name);
    if (!existsSync(bin) || !existsSync(meta)) {
      console.error(
        `Embedding files not found for collection '${name}'.\n` +
        `Expected: ${bin}  and  ${meta}\n` +
        "Run the one-time export first:\n  uv run scripts/export_embeddings.py"
      );
      process.exit(1);
    }
  }

  // ─── Load HTS data ────────────────────────────────────────────────────────
  if (!existsSync(config.htsRawPath) || !existsSync(config.htsProcessedPath)) {
    console.error(
      `HTS data not found. Expected:\n  ${config.htsRawPath}\n  ${config.htsProcessedPath}\n` +
      "Run the Python ingest first: uv run scripts/ingest.py"
    );
    process.exit(1);
  }

  console.info("Loading HTS data…");
  const { flatEntries, chapters } = loadOrProcess(config.htsRawPath, config.htsProcessedPath);
  console.info(`Flat entries: ${flatEntries.length.toLocaleString()} | Chapters: ${chapters.size}`);

  // ─── Load in-memory vector stores ────────────────────────────────────────
  console.info("Loading embeddings into memory…");
  const avgStore = new VectorStore(COLLECTION_AVG);
  const leafStore = new VectorStore(COLLECTION_LEAF);
  const pathStore = new VectorStore(COLLECTION_PATH);

  for (const [store, name] of [[avgStore, COLLECTION_AVG], [leafStore, COLLECTION_LEAF], [pathStore, COLLECTION_PATH]] as const) {
    const { bin, meta } = embeddingFiles(name);
    store.load(bin, meta);
  }

  console.info(
    `Loaded: avg=${avgStore.count.toLocaleString()} leaf=${leafStore.count.toLocaleString()} path=${pathStore.count.toLocaleString()}`
  );

  // ─── Wire up classifiers ──────────────────────────────────────────────────
  const classifiers = {
    embeddings: new EmbeddingsClassifier(avgStore, leafStore, pathStore),
    gar: new GARClassifier(flatEntries),
    agentic: new AgenticClassifier(chapters),
    rerank: new RerankClassifier(avgStore),
  };

  // ─── Routes ───────────────────────────────────────────────────────────────

  server.get("/health", async () => {
    return { status: "ok", indexed_entries: avgStore.count };
  });

  server.post<{ Body: ClassifyRequest; Reply: ClassifyResponse }>(
    "/classify",
    async (request, reply) => {
      let body: ClassifyRequest;
      try {
        body = ClassifyRequestSchema.parse(request.body);
      } catch (err) {
        return reply.status(400).send({ error: String(err) } as unknown as ClassifyResponse);
      }

      // Warn on mismatched method-specific params
      for (const [param, intendedMethod] of Object.entries(PARAM_METHODS)) {
        const value = (body as Record<string, unknown>)[param];
        if (value !== null && value !== undefined && body.method !== intendedMethod) {
          console.warn(
            `classify | ${param}=${JSON.stringify(value)} has no effect for method=${JSON.stringify(body.method)} ` +
            `(only used by ${JSON.stringify(intendedMethod)})`
          );
        }
      }

      switch (body.method) {
        case "embeddings":
          return classifiers.embeddings.classify(body.description, body.top_k, body.path_weight);
        case "gar":
          return classifiers.gar.classify(body.description, body.top_k);
        case "rerank":
          return classifiers.rerank.classify(body.description, body.top_k, body.candidate_pool);
        case "agentic":
          return classifiers.agentic.classify(body.description, body.top_k, body.beam_width);
        default:
          return reply.status(400).send({ error: `Unknown method: ${body.method}` } as unknown as ClassifyResponse);
      }
    }
  );

  // ─── Start ────────────────────────────────────────────────────────────────
  await server.listen({ port: config.port, host: "0.0.0.0" });
  console.info(`HTS Classifier (TS) listening on http://localhost:${config.port}`);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
