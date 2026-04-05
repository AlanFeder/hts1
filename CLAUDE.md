# CLAUDE.md — HTS Classifier

## Project overview
AI-powered backend to classify shipment descriptions into HTS (Harmonized Tariff Schedule) codes.
Backend only (FastAPI). Frontend is a separate project.

## Stack
- Python 3.11+, FastAPI, uv
- Vertex AI via `google-cloud-aiplatform` (no API key — uses application default credentials)
- Generation model: `gemini-2.0-flash-lite`
- Embedding model: `text-embedding-005`
- Vector store: ChromaDB (local persistent)
- BM25: `rank-bm25`
- GCP project: `project-misc-1`, region: `us-central1`

## Running the project

```bash
# First time only: ingest HTS data
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
- Use Python `logging` (not `print`) in classifier/service code; `print` is OK in scripts

## Data flow
```
USITC JSON → fetch_hts_data() → [cached: data/hts_raw.json]
           → build_tree_and_flat() → flat HTSEntry list + HTSNode chapter tree
           → [cached: data/hts_processed.json]  ← loaded at server startup
           → embed_entries() → ChromaDB [cached: data/chroma/]  ← queried at runtime
```

## Adding a new classifier
1. Create `hts_classifier/classifiers/your_method.py`, extend `BaseClassifier`
2. Add the method literal to `ClassifyRequest` in `core/models.py`
3. Register it in `app.py` lifespan under `app.state.classifiers`

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
│   └── vector_store.py         ChromaDB wrapper
├── classifiers/
│   ├── base.py                 BaseClassifier ABC
│   ├── embeddings.py           Method 1: cosine similarity
│   ├── gar.py                  Method 2: LLM term expansion + BM25
│   ├── agentic.py              Method 3: level-by-level beam search
│   └── rerank.py               Method 4: embeddings retrieval + LLM rerank
└── api/routes/
    ├── classify.py             POST /classify
    └── health.py               GET /health
scripts/
└── ingest.py                   One-time ingestion (download, embed, store)
docs/
├── mechanisms.md               How each classifier works
└── hts_json_processing.md      HTS JSON structure and path-building algorithm
```
