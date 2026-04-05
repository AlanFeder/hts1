# CLAUDE.md — HTS Classifier

## Project overview
AI-powered backend to classify shipment descriptions into HTS (Harmonized Tariff Schedule) codes.
Backend only (FastAPI). Frontend is a separate project.

## Stack
- Python 3.11+, FastAPI, uv
- Vertex AI via `google-genai` SDK (no API key — uses application default credentials)
- Generation model: `gemini-2.5-flash-lite` (configurable via `GENERATION_MODEL` in .env)
- Embedding model: `text-embedding-005`
- Vector store: ChromaDB (local persistent, 3 collections)
- BM25: `rank-bm25`
- GCP project: `project-misc-1`, region: `us-central1`

## Running the project

```bash
# First time only: ingest HTS data (resumes if interrupted)
uv run scripts/ingest.py

# Test ingest on a small slice first
uv run scripts/ingest.py --limit 100
uv run scripts/ingest.py --chapters 84,85

# Start the server
uv run main.py
```

## Key conventions
- Use modern Python type syntax: `X | Y`, `list[X]`, `dict[K, V]` (no `Optional`, no `Union`)
- Pydantic v2 for all schemas
- All Vertex AI calls are async (run sync SDK in executor via `loop.run_in_executor`)
- Every classifier returns `intermediates` in the response — log all scores and LLM outputs
- Use `loguru` with f-strings: `logger.info(f"msg {val!r}")` — NOT printf `%r` style (loguru ignores args)
- `embed_texts()` handles batching internally — sequential, 250 texts or 30k chars per batch. Do not manually batch.
- Use thread-local clients (`threading.local`) for genai.Client — shared singleton breaks under run_in_executor

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
  "method": "embeddings",       // or "gar", "agentic", "rerank"
  "top_k": 5,
  "path_weight": null           // embeddings only: 0.0–1.0 or null for avg
}
```

## Adding a new classifier
1. Create `hts_classifier/classifiers/your_method.py`, extend `BaseClassifier`
2. Implement `classify(self, description, top_k, path_weight=None) -> ClassifyResponse`
3. Add the method literal to `ClassifyRequest` in `core/models.py`
4. Register it in `app.py` lifespan under `app.state.classifiers`

## File structure
```
hts_classifier/
├── app.py                      FastAPI app, lifespan startup, classifier wiring
├── core/
│   ├── config.py               Settings (pydantic-settings, reads .env)
│   └── models.py               ClassifyRequest / ClassifyResponse / HTSResult
├── data/
│   ├── loader.py               fetch_hts_data() — downloads + caches raw JSON
│   └── processor.py            build_tree_and_flat(), load_or_process()
├── services/
│   ├── vertex.py               embed_texts(), embed_query(), generate_text()
│   └── vector_store.py         ChromaDB wrapper (COLLECTION_AVG/LEAF/PATH constants)
├── classifiers/
│   ├── base.py                 BaseClassifier ABC
│   ├── embeddings.py           Method 1: cosine similarity, supports path_weight
│   ├── gar.py                  Method 2: LLM term expansion + BM25
│   ├── agentic.py              Method 3: level-by-level beam search
│   └── rerank.py               Method 4: embeddings retrieval + LLM rerank
└── api/routes/
    ├── classify.py             POST /classify
    └── health.py               GET /health
scripts/
└── ingest.py                   Ingestion: download, embed → 3 ChromaDB collections (resumable)
docs/
├── mechanisms.md               How each classifier works
├── hts_json_processing.md      HTS JSON structure and path-building algorithm
└── status.md                   Current implementation status
```

## Known issues / gotchas
- `onnxruntime` 1.20+ dropped Intel Mac (x86_64) wheels; pinned to `<1.20` via `[tool.uv] override-dependencies`
- Vertex AI embedding API limits: 250 texts/request, 20k tokens/request. `embed_texts()` handles both.
- Vertex AI rate limits (429) can occur during full ingest — just re-run, ingest resumes from where it left off.
- `genai.Client` is not thread-safe when shared across `run_in_executor` threads — use `threading.local` per thread.

## Working with Alan
- Keep responses concise — no trailing summaries, no restating what was just done
- Fix type errors for real when possible; only use `# ty: ignore[rule]` for genuine third-party false positives
- Loguru uses f-string style, not printf `%` style — always use f-strings in logger calls
- Prefer sequential simplicity over async complexity for one-time scripts (ingest is a script, not a server)
- Ask before taking destructive actions (deleting data, force-pushing, etc.)
- Run `uv run ty check` and `uv run ruff check` after code changes to catch issues early
