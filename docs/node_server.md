# Node.js Server

A TypeScript/Fastify reimplementation of the HTS Classifier backend. Feature-identical to the Python server; shares the same `.env`, HTS data files, and API contract.

## File structure

```
src/
├── index.ts               Fastify server: startup, route registration, classifier wiring
├── config.ts              Env vars (reads same .env as Python server)
├── types.ts               Zod request schema + TypeScript interfaces
├── data/
│   └── processor.ts       HTS tree builder + flat entry loader (mirrors processor.py)
├── services/
│   ├── vertex.ts          embedTexts, embedQuery, generateText, embedCost, cosineSimilarity
│   └── vectorStore.ts     In-memory vector store: Float32Array + min-heap top-k
└── classifiers/
    ├── embeddings.ts      Cosine similarity, path_weight blending
    ├── gar.ts             BM25 (self-contained Okapi) + LLM term expansion
    ├── rerank.ts          Embedding retrieval → LLM rerank
    └── agentic.ts         Explore/finalize tree traversal
```

## Prerequisites

- Node.js 20+
- Python ingest already run (`uv run scripts/ingest.py`) — the Node server reads the same data files

## Setup

```bash
# Install Node deps
npm install

# One-time: export ChromaDB embeddings to binary files
uv run scripts/export_embeddings.py

# Start (development, with tsx hot reload)
npm run dev

# Build + start (production)
npm run build
npm start
```

Server listens on port **3000** by default (set `PORT=` in `.env` to change).

Swagger UI: `http://localhost:3000/docs`

## Data files

The Node server does not use ChromaDB directly. Instead, `scripts/export_embeddings.py` converts the three ChromaDB collections into binary files that are loaded into memory at startup:

| File | Size | Contents |
|---|---|---|
| `data/embeddings_avg.bin` | ~91 MB | avg(leaf, path) embeddings |
| `data/embeddings_avg_meta.json` | ~8 MB | Metadata for avg collection |
| `data/embeddings_leaf.bin` | ~91 MB | Leaf description embeddings |
| `data/embeddings_leaf_meta.json` | ~8 MB | Metadata for leaf collection |
| `data/embeddings_path.bin` | ~91 MB | Full path string embeddings |
| `data/embeddings_path_meta.json` | ~8 MB | Metadata for path collection |

Binary format: `[N: uint32LE][dim: uint32LE][N × dim × float32LE]`

Total memory at runtime: ~275 MB for all three `Float32Array` stores.

If ChromaDB data changes (re-ingest), re-run the export:
```bash
uv run scripts/export_embeddings.py
```

## Vector store

**File:** [src/services/vectorStore.ts](../src/services/vectorStore.ts)

All three collections are loaded once at startup into `Float32Array`. Vectors are **pre-normalised** at load time so query-time cosine similarity is a pure dot product loop — no per-vector norm computation at runtime.

Top-k selection uses a **min-heap** (O(N·k)) rather than sorting all N entries, which is faster for small k against large N.

Typical query time: **10–20 ms** for 29,807 × 768 dimensions.

## BM25

**File:** [src/classifiers/gar.ts](../src/classifiers/gar.ts)

A self-contained Okapi BM25 implementation (k₁=1.5, b=0.75) — no external library. Built from the flat entry `path_string` values at startup. Scores returned as a `Float64Array` for efficiency.

## Vertex AI

**File:** [src/services/vertex.ts](../src/services/vertex.ts)

Uses `@google/genai` with `vertexai: true`, which picks up **Application Default Credentials** automatically — same as the Python server.

Key functions:

| Function | Description |
|---|---|
| `embedTexts(texts, taskType)` | Batch embed with 250-text / 30k-char batching |
| `embedQuery(text)` | Single query embed (`RETRIEVAL_QUERY` task type) |
| `generateText(prompt)` | Returns `{ text, inputTokens, outputTokens, costUsd }` |
| `embedCost(texts)` | Approximate cost: `sum(chars) × $0.000025/1K` |
| `cosineSimilarity(a, b)` | Used by agentic embedding prefilter |

Pricing constants (gemini-2.5-flash-lite):
- Input: $0.10 / 1M tokens
- Output: $0.40 / 1M tokens
- Embeddings: $0.000025 / 1K characters

## Differences from Python server

| Aspect | Python | Node.js |
|---|---|---|
| Vector store | ChromaDB embedded (SQLite + HNSW) | In-memory `Float32Array`, brute-force cosine |
| BM25 | `rank-bm25` package | Inline Okapi BM25 implementation |
| Async model | `asyncio` + `run_in_executor` for sync SDK calls | Native `async/await` (SDK is already async) |
| Validation | Pydantic v2 | Zod |
| Logging | `loguru` | `console.info/warn/debug` |
| Classifier dispatch | Polymorphism via `BaseClassifier` ABC | `switch` statement in route handler |
| Embeddings parallelism | Sequential (Python SDK constraint) | `Promise.all` for leaf+path queries in embeddings |

## Example requests

```bash
# Embeddings (fast baseline)
curl -s -X POST http://localhost:3000/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "16 inch MacBook Pro laptop computer", "method": "embeddings", "top_k": 5}' | jq .

# Embeddings with path weighting
curl -s -X POST http://localhost:3000/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "16 inch MacBook Pro laptop computer", "method": "embeddings", "path_weight": 0.7}' | jq .

# GAR (LLM term expansion + BM25)
curl -s -X POST http://localhost:3000/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "iPhone", "method": "gar"}' | jq .

# Agentic (tree traversal, explore/finalize)
curl -s -X POST http://localhost:3000/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "iPhone", "method": "agentic", "beam_width": 5}' | jq .

# Rerank (embeddings retrieval + LLM rerank)
curl -s -X POST http://localhost:3000/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "iPhone", "method": "rerank", "candidate_pool": 30}' | jq .
```

## Scripts

| Script | Command | Description |
|---|---|---|
| Export embeddings | `uv run scripts/export_embeddings.py` | One-time: ChromaDB → binary files |
| Dev server | `npm run dev` | Start with `tsx` (no build step) |
| Build | `npm run build` | Compile TypeScript to `dist/` |
| Type check | `npx tsc --noEmit` | Verify types without emitting |
