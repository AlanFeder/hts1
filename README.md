# HTS Classifier

AI-powered backend to classify shipment descriptions into US Harmonized Tariff Schedule (HTS) codes.

## Problem

When a shipment arrives with a description like "16 inch MacBook Pro with M4 chip", simple keyword search fails for two reasons:
1. **Semantic mismatch** — "MacBook Pro" vs "automatic data processing machines" (the actual HTS term)
2. **Hierarchical structure** — HTS codes are nested 12 levels deep; the right code depends on navigating a tree, not matching a flat list

## Solution

Four AI classification methods, selectable per request:

| Method | Approach | LLM calls | Best for |
|--------|----------|-----------|----------|
| `embeddings` | Embed query → cosine similarity | 0 | Fast baseline, high volume |
| `gar` | LLM generates trade terms → BM25 | 1 | Consumer language → trade terminology |
| `agentic` | LLM navigates HTS tree, explore/finalize at each level | 4–8 | Complex/ambiguous, needs audit trail |
| `rerank` | Embeddings retrieval → LLM reranking | 1 | Best single-call accuracy |

See [docs/mechanisms.md](docs/mechanisms.md) for detailed descriptions.

## Two server implementations

| | Python (FastAPI) | Node.js (Fastify) |
|---|---|---|
| Entry point | `uv run main.py` | `npm run dev` |
| Default port | 8000 | 3000 |
| Swagger UI | `http://localhost:8000/docs` | `http://localhost:3000/docs` |
| Vector store | ChromaDB embedded | In-memory `Float32Array` |
| BM25 | `rank-bm25` | Self-contained Okapi implementation |

Both implementations are feature-identical and share the same `.env`, HTS data files, and API contract. See [docs/node_server.md](docs/node_server.md) for Node.js-specific setup.

## API

```
POST /classify
{
  "description": "16 inch MacBook Pro laptop computer",
  "method": "embeddings",     // "embeddings" | "gar" | "agentic" | "rerank"
  "top_k": 5,
  "path_weight": null,        // embeddings only: 0.0–1.0 blend of leaf vs path embeddings
  "candidate_pool": null,     // rerank only: retrieval pool size (default 20)
  "beam_width": null          // agentic only: overrides BEAM_WIDTH env var
}
```

Response includes `results` (ranked HTS codes with scores), `cost_usd` (approximate Vertex AI cost), and `intermediates` (all intermediate scores/LLM outputs for transparency).

```
GET /health
→ { "status": "ok", "indexed_entries": 29807 }
```

## Prerequisites

- GCP project with Vertex AI enabled
- Application Default Credentials: `gcloud auth application-default login`
- **Python server:** Python 3.11+, `uv`
- **Node.js server:** Node.js 20+, `npm`

## `.env`

```
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1

# Optional tuning
GENERATION_MODEL=gemini-2.5-flash-lite     # default
EMBEDDING_MODEL=text-embedding-005         # default
BEAM_WIDTH=3                               # agentic classifier beam width (default 3)
```

## Setup — Python server

```bash
# Install dependencies
uv sync

# Ingest HTS data (one-time, ~10–20 min) — test with a small slice first
uv run scripts/ingest.py --chapters 84,85  # electronics chapters (~3,500 entries)
uv run scripts/ingest.py                   # full ingest (29,807 entries)

# Run
uv run main.py
```

Ingest is **resumable** — re-run after a rate-limit error and it picks up where it left off.

## Setup — Node.js server

```bash
# Install dependencies
npm install

# One-time export: convert ChromaDB → binary files for in-memory loading
# (requires Python ingest to have run first)
uv run scripts/export_embeddings.py

# Run
npm run dev
```

See [docs/node_server.md](docs/node_server.md) for full details.

## Data source

[USITC HTS 2026 Revision 4](https://www.usitc.gov/sites/default/files/tata/hts/hts_2026_revision_4_json.json) — 35,733 entries, 12 hierarchy levels. 29,807 entries have actual HTS codes and are indexed; the remainder are structural headings used only for path-building.

See [docs/hts_json_processing.md](docs/hts_json_processing.md) for how the raw JSON is processed.

## Current status

See [docs/status.md](docs/status.md) for current implementation state and example curl commands.
