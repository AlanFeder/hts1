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

## Setup

### Prerequisites
- Python 3.11+
- `uv`
- GCP project with Vertex AI enabled
- Application Default Credentials: `gcloud auth application-default login`

### `.env`
```
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=global

# Optional tuning
GENERATION_MODEL=gemini-2.5-flash-lite     # default fallback (GAR uses gemini-3.1-pro-preview, agentic uses gemini-3-flash-preview)
EMBEDDING_MODEL=text-embedding-005         # default
BEAM_WIDTH=3                               # agentic classifier beam width (default 3)
```

### Install
```bash
uv sync
```

### Ingest HTS data (one-time, ~10–20 min)
```bash
# Test first with a small slice
uv run scripts/ingest.py --chapters 84,85  # electronics chapters (~3,500 entries)
uv run scripts/ingest.py --limit 100       # first 100 entries only

# Full ingest (29,807 entries)
uv run scripts/ingest.py
```

Ingest is **resumable** — if it fails (e.g. rate limit), just re-run and it picks up where it left off.

Embeddings are cached in `data/chroma/` across **3 collections**: avg, leaf, and path. To start fresh:
```bash
rm -rf data/chroma data/hts_raw.json data/hts_processed.json
uv run scripts/ingest.py
```

### Run the server
```bash
uv run main.py
```

## Data source

[USITC HTS 2026 Revision 4](https://www.usitc.gov/sites/default/files/tata/hts/hts_2026_revision_4_json.json) — 35,733 entries, 12 hierarchy levels. 29,807 entries have actual HTS codes and are indexed; the remainder are structural headings used only for path-building.

See [docs/hts_json_processing.md](docs/hts_json_processing.md) for how the raw JSON is processed.

## Current status

See [docs/status.md](docs/status.md) for current implementation state and example curl commands.
