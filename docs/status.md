# Project Status

Last updated: 2026-04-06

## Current state: deployed at https://hts.alanfeder.com

### What's done — deployment
- Live at https://hts.alanfeder.com (GCP e2-micro, us-central1-a)
- nginx serving static frontend + reverse proxying `/classify` to FastAPI
- systemd service (`hts.service`) — auto-starts on reboot, 2 uvicorn workers, no reload
- Let's Encrypt SSL cert (auto-renewing)
- Namecheap DNS A record pointing to VM IP
- Warmup embed call at startup so first request isn't slow
- Not indexed (robots.txt + noindex meta)
- See `docs/deployment.md` for full details and deploy instructions

### What's done — backend (Python/FastAPI)
- All 4 classifiers implemented: `embeddings`, `gar`, `agentic`, `rerank`
- `path_weight` param on embeddings (0.0=leaf-only, 1.0=path-only, null=avg)
- `candidate_pool` param on rerank (overrides default pool of 20)
- `beam_width` param on agentic (overrides `BEAM_WIDTH` env var)
- Warnings logged when method-specific params are sent to wrong method
- `cost_usd` field on every response — approximate Vertex AI cost for the request
- `elapsed_ms` field on every response — wall-clock time for the classify call (ms)
- `generate_text()` returns `GenerateResult(text, input_tokens, output_tokens)` — cost computed from `usage_metadata`
- Agentic redesigned: explore/finalize loop instead of greedy beam search
  - LLM sees all beam nodes at each depth (embedding-prefiltered to 50 if >50)
  - LLM can finalize intermediate nodes (not just leaves)
  - Accumulates `final_pool` across depths rather than committing to one branch
- Ingest script is resumable — checks ChromaDB for already-indexed IDs, skips them
- Ingest writes 3 ChromaDB collections: avg, leaf, path
- Logging clean across all classifiers (f-strings, not printf)
- Type checks and lint clean (`uv run ty check` and `uv run ruff check` pass)
- CORS middleware enabled for `localhost:5173` (Vite dev) and `localhost:4173` (Vite preview)

### What's done — frontend (React/Vite)
- **Classify tab**: single-method flow with form, results table, method internals panel
- **Compare tab**: all 4 methods run in parallel; summary bars for time + cost; per-method expandable cards
- Method-specific intermediates panels:
  - Embeddings: embedding stats, cosine similarity bars
  - GAR: expanded term chips, BM25 score bars, raw LLM response toggle
  - Rerank: side-by-side initial vs. reranked with rank movement indicators
  - Agentic: collapsible beam trace (chapter selection → depth steps → final ranking)
- Professional government-tech design (navy/gold palette, Inter + JetBrains Mono fonts)
- TypeScript strict mode, zero type errors

### Pending
- Manual testing of all 4 methods on representative queries to compare quality
- Evaluate best `path_weight` values for embeddings
- Evaluate agentic accuracy now that explore/finalize redesign is in

## Ingest details

```bash
# Full ingest (creates/resumes all 3 ChromaDB collections)
uv run scripts/ingest.py

# To start completely fresh
rm -rf data/chroma data/hts_raw.json data/hts_processed.json
uv run scripts/ingest.py
```

- 29,807 entries with real HTS codes (out of 35,733 raw rows; the rest are structural headings with no code)
- Chunk size: 2,000 entries — upserted to ChromaDB after each chunk completes
- Resume detection: checks `hts_entries` (avg) collection for already-indexed IDs

## API

Server runs at `http://localhost:8000`. Docs at `/docs`.

```bash
uv run main.py
```

Example requests:

```bash
# Embeddings (fast baseline)
curl -s -X POST http://localhost:8000/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "16 inch MacBook Pro laptop computer", "method": "embeddings", "top_k": 5}' | jq .

# Embeddings with path weighting
curl -s -X POST http://localhost:8000/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "16 inch MacBook Pro laptop computer", "method": "embeddings", "path_weight": 0.7}' | jq .

# GAR (LLM term expansion + BM25)
curl -s -X POST http://localhost:8000/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "iPhone", "method": "gar"}' | jq .

# Agentic (tree traversal, explore/finalize)
curl -s -X POST http://localhost:8000/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "iPhone", "method": "agentic", "beam_width": 5}' | jq .

# Rerank (embeddings retrieval + LLM rerank)
curl -s -X POST http://localhost:8000/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "iPhone", "method": "rerank", "candidate_pool": 30}' | jq .
```
