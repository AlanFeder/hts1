# Project Status

Last updated: 2026-04-05

## Current state: fully implemented, ingesting

### What's done
- All 4 classifiers implemented and working: `embeddings`, `gar`, `agentic`, `rerank`
- `path_weight` param added to embeddings classifier (0.0=leaf-only, 1.0=path-only, null=avg)
- Ingest script is resumable — checks ChromaDB for already-indexed IDs, skips them
- Ingest now writes 3 ChromaDB collections: avg, leaf, path
- Logging fixed across all classifiers (f-strings, not printf)
- Type checks clean (`uv run ty check` passes)

### What needs to happen before the app is fully usable
1. **Re-ingest** — ChromaDB was deleted. Run `uv run scripts/ingest.py` to rebuild all 3 collections.
   - This takes ~10–20 min (sequential, ~240 API calls per pass × 2 passes × 3 collections... actually 2 embedding passes cover all 3 collections per chunk, so ~240 calls per chunk pass)
   - If it hits 429 rate limits, just re-run — resumes from last completed chunk
2. **Test the weighted embeddings** — `path_weight` was just added; needs a live test once ingest completes

### Known pending work
- Evaluate which `path_weight` values give best results on representative queries
- Frontend (separate project)
- Possible: experiment with `gemini-embedding-001` (newer model) vs `text-embedding-005`

## Ingest details

```bash
# Full ingest (creates/resumes all 3 ChromaDB collections)
uv run scripts/ingest.py

# To start completely fresh
rm -rf data/chroma data/chroma_test data/hts_raw.json data/hts_processed.json data/hts_processed_test.json
uv run scripts/ingest.py
```

- 29,807 entries with real HTS codes (out of 35,733 raw rows; the rest are structural headings with no code)
- Chunk size: 2,000 entries — upserted to ChromaDB after each chunk completes
- Resume detection: checks `hts_entries` (avg) collection for already-indexed IDs

## API status
Server runs at `http://localhost:8000`. Docs at `/docs`.

```bash
uv run main.py
```

Example request:
```bash
curl -s -X POST http://localhost:8000/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "16 inch MacBook Pro laptop computer", "method": "embeddings", "top_k": 5}' | jq .
```

With path weighting:
```bash
curl -s -X POST http://localhost:8000/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "16 inch MacBook Pro laptop computer", "method": "embeddings", "path_weight": 0.7}' | jq .
```
