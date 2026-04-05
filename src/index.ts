import { existsSync } from "node:fs";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { AgenticClassifier } from "./classifiers/agentic.js";
import { EmbeddingsClassifier } from "./classifiers/embeddings.js";
import { GARClassifier } from "./classifiers/gar.js";
import { RerankClassifier } from "./classifiers/rerank.js";
import { config } from "./config.js";
import { loadOrProcess } from "./data/processor.js";
import {
	COLLECTION_AVG,
	COLLECTION_LEAF,
	COLLECTION_PATH,
	VectorStore,
} from "./services/vectorStore.js";
import type { ClassifyRequest, ClassifyResponse } from "./types.js";
import { ClassifyRequestSchema } from "./types.js";

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
	const server = Fastify({
		logger: false,
		ajv: { customOptions: { strict: false } },
	});

	// ─── OpenAPI / Swagger ────────────────────────────────────────────────────
	await server.register(swagger, {
		openapi: {
			info: {
				title: "HTS Classifier",
				description: "AI-powered Harmonized Tariff Schedule classifier",
				version: "0.1.0",
			},
			servers: [{ url: `http://localhost:${config.port}` }],
		},
	});
	await server.register(swaggerUi, { routePrefix: "/docs" });

	// ─── Check exported embedding files ───────────────────────────────────────
	for (const name of [COLLECTION_AVG, COLLECTION_LEAF, COLLECTION_PATH]) {
		const { bin, meta } = embeddingFiles(name);
		if (!existsSync(bin) || !existsSync(meta)) {
			console.error(
				`Embedding files not found for collection '${name}'.\n` +
					`Expected: ${bin}  and  ${meta}\n` +
					"Run the one-time export first:\n  uv run scripts/export_embeddings.py",
			);
			process.exit(1);
		}
	}

	// ─── Load HTS data ────────────────────────────────────────────────────────
	if (!existsSync(config.htsRawPath) || !existsSync(config.htsProcessedPath)) {
		console.error(
			`HTS data not found. Expected:\n  ${config.htsRawPath}\n  ${config.htsProcessedPath}\n` +
				"Run the Python ingest first: uv run scripts/ingest.py",
		);
		process.exit(1);
	}

	console.info("Loading HTS data…");
	const { flatEntries, chapters } = loadOrProcess(
		config.htsRawPath,
		config.htsProcessedPath,
	);
	console.info(
		`Flat entries: ${flatEntries.length.toLocaleString()} | Chapters: ${chapters.size}`,
	);

	// ─── Load in-memory vector stores ────────────────────────────────────────
	console.info("Loading embeddings into memory…");
	const avgStore = new VectorStore(COLLECTION_AVG);
	const leafStore = new VectorStore(COLLECTION_LEAF);
	const pathStore = new VectorStore(COLLECTION_PATH);

	for (const [store, name] of [
		[avgStore, COLLECTION_AVG],
		[leafStore, COLLECTION_LEAF],
		[pathStore, COLLECTION_PATH],
	] as const) {
		const { bin, meta } = embeddingFiles(name);
		store.load(bin, meta);
	}

	console.info(
		`Loaded: avg=${avgStore.count.toLocaleString()} leaf=${leafStore.count.toLocaleString()} path=${pathStore.count.toLocaleString()}`,
	);

	// ─── Wire up classifiers ──────────────────────────────────────────────────
	const classifiers = {
		embeddings: new EmbeddingsClassifier(avgStore, leafStore, pathStore),
		gar: new GARClassifier(flatEntries),
		agentic: new AgenticClassifier(chapters),
		rerank: new RerankClassifier(avgStore),
	};

	// ─── Routes ───────────────────────────────────────────────────────────────

	server.get(
		"/health",
		{
			schema: {
				summary: "Health check",
				response: {
					200: {
						type: "object",
						properties: {
							status: { type: "string", example: "ok" },
							indexed_entries: { type: "number", example: 29807 },
						},
					},
				},
			},
		},
		async () => ({ status: "ok", indexed_entries: avgStore.count }),
	);

	server.post<{ Body: ClassifyRequest; Reply: ClassifyResponse }>(
		"/classify",
		{
			schema: {
				summary: "Classify a shipment description into HTS codes",
				body: {
					type: "object",
					required: ["description"],
					properties: {
						description: {
							type: "string",
							example: "16 inch MacBook Pro laptop computer",
						},
						method: {
							type: "string",
							enum: ["embeddings", "gar", "agentic", "rerank"],
							default: "embeddings",
						},
						top_k: { type: "integer", default: 5, minimum: 1 },
						path_weight: {
							type: "number",
							minimum: 0,
							maximum: 1,
							nullable: true,
							description:
								"embeddings only: blend of leaf vs path score (0=leaf, 1=path, null=avg collection)",
						},
						candidate_pool: {
							type: "integer",
							minimum: 1,
							nullable: true,
							description:
								"rerank only: retrieval pool size before LLM rerank (default 20)",
						},
						beam_width: {
							type: "integer",
							minimum: 1,
							nullable: true,
							description: "agentic only: chapter selection width (default 3)",
						},
					},
				},
				response: {
					200: {
						type: "object",
						properties: {
							results: {
								type: "array",
								items: {
									type: "object",
									properties: {
										hts_code: { type: "string" },
										description: { type: "string" },
										path: { type: "array", items: { type: "string" } },
										score: { type: "number" },
										general_rate: { type: "string", nullable: true },
									},
								},
							},
							method: { type: "string" },
							query: { type: "string" },
							cost_usd: { type: "number", nullable: true },
							intermediates: {
								type: "object",
								nullable: true,
								additionalProperties: true,
							},
						},
					},
				},
			},
		},
		async (request, reply) => {
			let body: ClassifyRequest;
			try {
				body = ClassifyRequestSchema.parse(request.body);
			} catch (err) {
				return reply
					.status(400)
					.send({ error: String(err) } as unknown as ClassifyResponse);
			}

			// Warn on mismatched method-specific params
			for (const [param, intendedMethod] of Object.entries(PARAM_METHODS)) {
				const value = (body as Record<string, unknown>)[param];
				if (
					value !== null &&
					value !== undefined &&
					body.method !== intendedMethod
				) {
					console.warn(
						`classify | ${param}=${JSON.stringify(value)} has no effect for method=${JSON.stringify(body.method)} ` +
							`(only used by ${JSON.stringify(intendedMethod)})`,
					);
				}
			}

			switch (body.method) {
				case "embeddings":
					return classifiers.embeddings.classify(
						body.description,
						body.top_k,
						body.path_weight,
					);
				case "gar":
					return classifiers.gar.classify(body.description, body.top_k);
				case "rerank":
					return classifiers.rerank.classify(
						body.description,
						body.top_k,
						body.candidate_pool,
					);
				case "agentic":
					return classifiers.agentic.classify(
						body.description,
						body.top_k,
						body.beam_width,
					);
				default:
					return reply.status(400).send({
						error: `Unknown method: ${body.method}`,
					} as unknown as ClassifyResponse);
			}
		},
	);

	// ─── Start ────────────────────────────────────────────────────────────────
	await server.listen({ port: config.port, host: "0.0.0.0" });
	console.info(
		`HTS Classifier (TS) listening on http://localhost:${config.port}`,
	);
	console.info(`Swagger UI: http://localhost:${config.port}/docs`);
}

main().catch((err) => {
	console.error("Fatal startup error:", err);
	process.exit(1);
});
