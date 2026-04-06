# CLAUDE.md — HTS Classifier

## Project overview
AI-powered tool to classify shipment descriptions into HTS (Harmonized Tariff Schedule) codes.
Python/FastAPI backend + React/Vite frontend.

## Stack

**Backend**
- Python 3.11+, FastAPI, uv
- Vertex AI via `google-genai` SDK (no API key — uses application default credentials)
- Generation model: `gemini-2.5-flash-lite` (configurable via `GENERATION_MODEL` in .env)
- Embedding model: `text-embedding-005`
- Vector store: ChromaDB (local persistent, 3 collections)
- BM25: `rank-bm25` (used only in GAR classifier)
- GCP project: `project-misc-1`, region: `us-central1`

**Frontend** (see `docs/frontend.md` for full details)
- React 18, Vite, TypeScript (strict)
- Tailwind CSS with custom navy/gold palette
- No external state library — plain `useState`

## Running the project

```bash
# First time only: ingest HTS data (resumes if interrupted)
uv run scripts/ingest.py

# Test ingest on a small slice first
uv run scripts/ingest.py --limit 100
uv run scripts/ingest.py --chapters 84,85

# Start the backend (port 8000)
uv run main.py

# Start the frontend (port 5173, separate terminal)
cd frontend && npm run dev
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
- `elapsed_ms`: wall-clock time for the classify call in milliseconds (server-side)
- `intermediates`: all intermediate scores and LLM outputs

## Adding a new classifier
1. Create `hts_classifier/classifiers/your_method.py`, extend `BaseClassifier`
2. Implement `classify(self, description, top_k, path_weight=None, candidate_pool=None, beam_width=None) -> ClassifyResponse`
3. Add the method literal to `ClassifyRequest` in `core/models.py`
4. Register it in `app.py` lifespan under `app.state.classifiers`
5. Add `candidate_pool` or `beam_width` to `_PARAM_METHODS` in `api/routes/classify.py` if the new method has a method-specific param

## File structure
```
hts_classifier/
├── app.py                      FastAPI app, lifespan startup, classifier wiring, CORS
├── core/
│   ├── config.py               Settings (pydantic-settings, reads .env)
│   └── models.py               ClassifyRequest / ClassifyResponse / HTSResult (+ elapsed_ms)
├── data/
│   ├── loader.py               fetch_hts_data() — downloads + caches raw JSON
│   └── processor.py            build_tree_and_flat(), load_or_process()
├── services/
│   ├── vertex.py               embed_texts(), embed_query(), generate_text() → GenerateResult
│   └── vector_store.py         ChromaDB wrapper (COLLECTION_AVG/LEAF/PATH constants)
├── classifiers/
│   ├── base.py                 BaseClassifier ABC
│   ├── embeddings.py           Method 1: cosine similarity, supports path_weight
│   ├── gar.py                  Method 2: LLM term expansion + BM25
│   ├── agentic.py              Method 3: explore/finalize tree traversal
│   └── rerank.py               Method 4: embeddings retrieval + LLM rerank
└── api/routes/
    ├── classify.py             POST /classify — times request, sets elapsed_ms
    └── health.py               GET /health
scripts/
└── ingest.py                   Ingestion: download, embed → 3 ChromaDB collections (resumable)
frontend/
├── index.html
├── vite.config.ts              Dev proxy: /classify + /health → localhost:8000
├── tailwind.config.js          Custom navy/gold palette, Inter + JetBrains Mono fonts
└── src/
    ├── App.tsx                 Two-tab shell (Classify / Compare Methods)
    ├── types.ts                TypeScript types + METHOD_META color constants
    ├── api.ts                  fetch wrapper for POST /classify
    └── components/
        ├── Header.tsx          Navy header, USITC branding, tab nav
        ├── ClassifyForm.tsx    Description input, method cards, advanced params
        ├── ResultsTable.tsx    HTS results table (full + compact variants)
        ├── SingleView.tsx      Single-method classify flow
        ├── CompareView.tsx     Parallel four-method comparison
        └── intermediates/      Per-method internals panels
            ├── IntermediatesPanel.tsx
            ├── EmbeddingsIntermediates.tsx
            ├── GarIntermediates.tsx
            ├── RerankIntermediates.tsx
            └── AgenticIntermediates.tsx
docs/
├── frontend.md                 Frontend architecture, components, design system
├── mechanisms.md               How each classifier works + API reference
├── agentic_search.md           Agentic classifier design notes
├── hts_json_processing.md      HTS JSON structure and path-building algorithm
├── deployment.md               Production deployment (GCP VM, nginx, systemd, SSL, deploy steps)
└── status.md                   Current implementation status and curl examples
```

## Known issues / gotchas

**Backend**
- `onnxruntime` 1.20+ dropped Intel Mac (x86_64) wheels; pinned to `<1.20` via `[tool.uv] override-dependencies`
- Vertex AI embedding API limits: 250 texts/request, 20k tokens/request. `embed_texts()` handles both.
- Vertex AI rate limits (429) can occur during full ingest — just re-run, ingest resumes from where it left off.
- `genai.Client` is not thread-safe when shared across `run_in_executor` threads — use `threading.local` per thread.
- Agentic classifier: chapter selection is the critical gate — if the correct chapter isn't selected, it's missed. Use `beam_width=5` for better coverage at the cost of more LLM calls.

**Frontend**
- CORS is restricted to `localhost:5173` and `localhost:4173` — update `app.py` if deploying to a real origin.
- The Compare view fires all 4 methods simultaneously; the agentic method can take 10–30 seconds and will hold the card in a loading state while others have already resolved.

## Working with Alan
- Keep responses concise — no trailing summaries, no restating what was just done
- Fix type errors for real when possible; only use `# ty: ignore[rule]` for genuine third-party false positives
- Loguru uses f-string style, not printf `%` style — always use f-strings in logger calls
- Prefer sequential simplicity over async complexity for one-time scripts (ingest is a script, not a server)
- Ask before taking destructive actions (deleting data, force-pushing, etc.)
- Run `uv run ty check` and `uv run ruff check` after code changes to catch issues early
