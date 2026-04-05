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

async function main() {
  const server = Fastify({ logger: false });

  // ─── Validate ChromaDB is accessible ──────────────────────────────────────
  // (ChromaDB HTTP server must be running — see README for startup instructions)

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

  // ─── Init ChromaDB collections ────────────────────────────────────────────
  console.info("Connecting to ChromaDB…");
  const avgStore = new VectorStore(COLLECTION_AVG);
  const leafStore = new VectorStore(COLLECTION_LEAF);
  const pathStore = new VectorStore(COLLECTION_PATH);

  try {
    await Promise.all([avgStore.init(), leafStore.init(), pathStore.init()]);
  } catch (err) {
    console.error(
      `Failed to connect to ChromaDB at ${config.chromaUrl}.\n` +
      "Start it with: chroma run --path data/chroma --port 8001\n",
      err
    );
    process.exit(1);
  }

  const [avgCount, leafCount, pathCount] = await Promise.all([
    avgStore.count,
    leafStore.count,
    pathStore.count,
  ]);
  console.info(`ChromaDB: avg=${avgCount.toLocaleString()} leaf=${leafCount.toLocaleString()} path=${pathCount.toLocaleString()}`);

  // ─── Wire up classifiers ──────────────────────────────────────────────────
  const classifiers = {
    embeddings: new EmbeddingsClassifier(avgStore, leafStore, pathStore),
    gar: new GARClassifier(flatEntries),
    agentic: new AgenticClassifier(chapters),
    rerank: new RerankClassifier(avgStore),
  };

  // ─── Routes ───────────────────────────────────────────────────────────────

  server.get("/health", async () => {
    return { status: "ok", indexed_entries: avgCount };
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

      const classifier = classifiers[body.method];
      let response: ClassifyResponse;

      switch (body.method) {
        case "embeddings":
          response = await (classifier as EmbeddingsClassifier).classify(
            body.description, body.top_k, body.path_weight
          );
          break;
        case "gar":
          response = await (classifier as GARClassifier).classify(
            body.description, body.top_k
          );
          break;
        case "rerank":
          response = await (classifier as RerankClassifier).classify(
            body.description, body.top_k, body.candidate_pool
          );
          break;
        case "agentic":
          response = await (classifier as AgenticClassifier).classify(
            body.description, body.top_k, body.beam_width
          );
          break;
        default:
          return reply.status(400).send({ error: `Unknown method: ${body.method}` } as unknown as ClassifyResponse);
      }

      return response;
    }
  );

  // ─── Start ────────────────────────────────────────────────────────────────
  await server.listen({ port: config.port, host: "0.0.0.0" });
  console.info(`HTS Classifier (TS) listening on http://localhost:${config.port}`);
  console.info(`Docs: http://localhost:${config.port}/docs (not available — use curl/Postman)`);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
