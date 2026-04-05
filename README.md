# HTS Classifier

AI-powered backend to classify shipment descriptions into US Harmonized Tariff Schedule (HTS) codes.

## Problem

When a shipment arrives with a description like "16 inch MacBook Pro with M4 chip", simple keyword search fails for two reasons:
1. **Semantic mismatch** — "MacBook Pro" vs "automatic data processing machines" (the actual HTS term)
2. **Hierarchical structure** — HTS codes are nested 12 levels deep; the right code depends on navigating a tree, not matching a flat list

## Solution

Four AI classification methods, selectable per request:

| Method | Approach | Best for |
|--------|----------|----------|
| `embeddings` | Embed query → cosine similarity against indexed HTS entries | Fast, good baseline |
| `gar` | LLM generates search terms → BM25 text search | When exact trade terminology matters |
| `agentic` | LLM navigates HTS tree level-by-level (beam search) | Complex or ambiguous descriptions |
| `rerank` | Embeddings retrieval (top 20) → LLM reranking | Best accuracy, moderate cost |

See [docs/mechanisms.md](docs/mechanisms.md) for detailed descriptions.

## API

```
POST /classify
{
  "description": "16 inch MacBook Pro laptop computer",
  "method": "embeddings",   // or "gar", "agentic", "rerank"
  "top_k": 5
}
```

Response includes `results` (ranked HTS codes with scores) and `intermediates` (all intermediate scores/LLM outputs for transparency).

```
GET /health
→ { "status": "ok", "indexed_entries": 17432 }
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
GOOGLE_CLOUD_LOCATION=us-central1

# Optional tuning
GENERATION_MODEL=gemini-2.5-flash-lite     # default
EMBEDDING_MODEL=text-embedding-005         # default
EMBEDDING_CONCURRENCY=8                    # concurrent embedding batches (default 8)
```

### Install
```bash
uv sync
```

### Ingest HTS data (one-time, ~2 min)
```bash
# Test first with a small slice
uv run scripts/ingest.py --chapters 84,85  # electronics chapters (~3,500 entries)
uv run scripts/ingest.py --limit 100       # first 100 entries only

# Full ingest (29,807 entries, ~2 min)
uv run scripts/ingest.py
```

Embeddings are cached in `data/chroma/`. Re-run only if the HTS data is updated (delete `data/chroma/` to force re-embedding).

### Run the server
```bash
uv run main.py
```

## Data source

[USITC HTS 2026 Revision 4](https://www.usitc.gov/sites/default/files/tata/hts/hts_2026_revision_4_json.json) — 35,733 entries, 12 hierarchy levels.

See [docs/hts_json_processing.md](docs/hts_json_processing.md) for how the raw JSON is processed.
