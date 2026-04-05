# CLAUDE.md — HTS Classifier

## Project overview
AI-powered backend to classify shipment descriptions into HTS (Harmonized Tariff Schedule) codes.
Two server implementations — Python (FastAPI) and Node.js (Fastify) — sharing the same API contract and data files. Frontend is a separate project.

## Stack

**Python server**
- Python 3.11+, FastAPI, uv
- Vertex AI via `google-genai` SDK (no API key — uses application default credentials)
- Generation model: `gemini-2.5-flash-lite` (configurable via `GENERATION_MODEL` in .env)
- Embedding model: `text-embedding-005`
- Vector store: ChromaDB (local persistent, 3 collections)
- BM25: `rank-bm25` (used only in GAR classifier)
- GCP project: `project-misc-1`, region: `us-central1`

**Node.js server**
- Node.js 20+, Fastify v5, TypeScript, tsx
- Vertex AI via `@google/genai` SDK with `vertexai: true` (same ADC, same models)
- Vector store: in-memory `Float32Array` loaded from binary export files (no ChromaDB server needed)
- BM25: self-contained Okapi implementation in `src/classifiers/gar.ts`
- Swagger UI at `/docs` via `@fastify/swagger` + `@fastify/swagger-ui`
- Validation: Zod

## Running the project

```bash
# Python server (port 8000)
uv run scripts/ingest.py        # first time: ingest HTS data (~10–20 min, resumable)
uv run main.py

# Node.js server (port 3000)
npm install                      # first time
uv run scripts/export_embeddings.py   # first time: ChromaDB → binary files
npm run dev
```

## Key conventions
- Use modern Python type syntax: `X | Y`, `list[X]`, `dict[K, V]` (no `Optional`, no `Union`)
- Pydantic v2 for all schemas
- All Vertex AI calls are async (run sync SDK in executor via `loop.run_in_executor`)
- Every classifier returns `intermediates` in the response — log all scores and LLM outputs
- Use `loguru` with f-strings: `logger.info(f"msg {val!r}")` — NOT printf `%r` style (loguru ignores args)
- `embed_texts()` handles batching internally — sequential, 250 texts or 30k chars per batch. Do not manually batch.
- Use thread-local clients (`threading.local`) for genai.Client — shared singleton breaks under run_in_executor
- `generate_text()` returns `GenerateResult(text, input_tokens, output_tokens)` — use `.text` for the string, `.cost_usd` for cost

## Data flow
```
USITC JSON → fetch_hts_data() → [cached: data/hts_raw.json]
           → build_tree_and_flat() → flat HTSEntry list + HTSNode chapter tree
           → [cached: data/hts_processed.json]  ← loaded at server startup
           → embed_entries() → ChromaDB [cached: data/chroma/]  ← queried at runtime
                               3 collections: hts_entries (avg), hts_entries_leaf, hts_entries_path
```

## ChromaDB collections
Three collections are populated at ingest time:

| Collection | Contents | Used when |
|---|---|---|
| `hts_entries` | avg(leaf, path) embedding | `path_weight=None` (default) |
| `hts_entries_leaf` | leaf description embedding only | `path_weight` is set (blended) |
| `hts_entries_path` | full path string embedding only | `path_weight` is set (blended) |

The `path_weight` field on `ClassifyRequest` (0.0–1.0) blends leaf and path scores at query time:
- `None` → use avg collection (fast, single query)
- `0.0` → leaf only
- `1.0` → path only
- `0.5` → equal blend

## API parameters
```json
POST /classify
{
  "description": "16 inch MacBook Pro",
  "method": "embeddings",       // "embeddings" | "gar" | "agentic" | "rerank"
  "top_k": 5,
  "path_weight": null,          // embeddings only: 0.0–1.0 or null for avg
  "candidate_pool": null,       // rerank only: retrieval pool size (default 20)
  "beam_width": null            // agentic only: overrides BEAM_WIDTH env var
}
```

Warnings are logged (not errors) if method-specific params are sent with the wrong method.

## Response
Every response includes:
- `results`: ranked HTS codes with scores
- `method`: which classifier was used
- `query`: original description
- `cost_usd`: approximate Vertex AI cost (generation from token counts, embedding from char count)
- `intermediates`: all intermediate scores and LLM outputs

## Adding a new classifier
1. Create `hts_classifier/classifiers/your_method.py`, extend `BaseClassifier`
2. Implement `classify(self, description, top_k, path_weight=None, candidate_pool=None, beam_width=None) -> ClassifyResponse`
3. Add the method literal to `ClassifyRequest` in `core/models.py`
4. Register it in `app.py` lifespan under `app.state.classifiers`
5. Add `candidate_pool` or `beam_width` to `_PARAM_METHODS` in `api/routes/classify.py` if the new method has a method-specific param

## File structure

```
hts_classifier/           Python server
├── main.py
├── hts_classifier/
│   ├── app.py                  FastAPI app, lifespan startup, classifier wiring
│   ├── core/
│   │   ├── config.py           Settings (pydantic-settings, reads .env)
│   │   └── models.py           ClassifyRequest / ClassifyResponse / HTSResult
│   ├── data/
│   │   ├── loader.py           fetch_hts_data() — downloads + caches raw JSON
│   │   └── processor.py        build_tree_and_flat(), load_or_process()
│   ├── services/
│   │   ├── vertex.py           embed_texts(), embed_query(), generate_text() → GenerateResult
│   │   └── vector_store.py     ChromaDB wrapper (COLLECTION_AVG/LEAF/PATH constants)
│   ├── classifiers/
│   │   ├── base.py             BaseClassifier ABC
│   │   ├── embeddings.py       Method 1: cosine similarity, supports path_weight
│   │   ├── gar.py              Method 2: LLM term expansion + BM25
│   │   ├── agentic.py          Method 3: explore/finalize tree traversal
│   │   └── rerank.py           Method 4: embeddings retrieval + LLM rerank
│   └── api/routes/
│       ├── classify.py         POST /classify
│       └── health.py           GET /health

src/                      Node.js server
├── index.ts                    Fastify server entry point
├── config.ts                   Env vars
├── types.ts                    Zod schema + TS interfaces
├── data/
│   └── processor.ts            HTS tree builder + flat entry loader
├── services/
│   ├── vertex.ts               embedTexts, embedQuery, generateText, embedCost
│   └── vectorStore.ts          In-memory Float32Array store (pre-normalised, min-heap top-k)
└── classifiers/
    ├── embeddings.ts
    ├── gar.ts                  Includes self-contained BM25 Okapi class
    ├── agentic.ts
    └── rerank.ts

scripts/
├── ingest.py                   Python: download + embed → ChromaDB (resumable)
└── export_embeddings.py        Python: ChromaDB → binary files for Node.js

docs/
├── mechanisms.md               How each classifier works + API reference
├── agentic_search.md           Agentic classifier design notes
├── hts_json_processing.md      HTS JSON structure and path-building algorithm
├── node_server.md              Node.js server setup and architecture
└── status.md                   Current implementation status and curl examples
```

## Known issues / gotchas

**Python**
- `onnxruntime` 1.20+ dropped Intel Mac (x86_64) wheels; pinned to `<1.20` via `[tool.uv] override-dependencies`
- Vertex AI embedding API limits: 250 texts/request, 20k tokens/request. `embed_texts()` handles both.
- Vertex AI rate limits (429) can occur during full ingest — just re-run, ingest resumes from where it left off.
- `genai.Client` is not thread-safe when shared across `run_in_executor` threads — use `threading.local` per thread.

**Node.js**
- `@fastify/swagger` requires Fastify v5 — don't downgrade Fastify.
- Fastify's AJV runs in strict mode by default; `example` in JSON Schema requires `ajv: { customOptions: { strict: false } }`.
- The Node server loads ~275 MB of `Float32Array` data at startup — startup takes a few seconds.
- If ChromaDB data changes (re-ingest), re-run `uv run scripts/export_embeddings.py` before restarting Node.

**Both**
- Agentic classifier: chapter selection is the critical gate — if the correct chapter isn't selected, it's missed. Use `beam_width=5` for better coverage at the cost of more LLM calls.

## Working with Alan
- Keep responses concise — no trailing summaries, no restating what was just done
- Fix type errors for real when possible; only use `# ty: ignore[rule]` for genuine third-party false positives
- Loguru uses f-string style, not printf `%` style — always use f-strings in logger calls
- Prefer sequential simplicity over async complexity for one-time scripts (ingest is a script, not a server)
- Ask before taking destructive actions (deleting data, force-pushing, etc.)
- Run `uv run ty check` and `uv run ruff check` after code changes to catch issues early
