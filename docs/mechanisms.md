# Classifier Mechanisms

Four backend methods share the same API contract (`POST /classify`) and return the same `ClassifyResponse` shape. Three are exposed in the frontend UI (Basic Semantic Search, LLM Rerank, GAR); the agentic method is backend-only.

---

## Method 1: Basic Semantic Search (`embeddings`)

**File:** `hts_classifier/classifiers/embeddings.py`

### How it works
1. Embed the query description using `text-embedding-005` with task type `RETRIEVAL_QUERY`
2. Query ChromaDB for the top-k nearest vectors by cosine similarity
3. Return results sorted by similarity score (0–1)

### path_weight parameter
Controls how leaf vs. path embeddings are blended at query time:

| `path_weight` | Behavior |
|---|---|
| `null` (default) | Query the avg collection directly — fastest, single query |
| `0.0` | Leaf description embedding only |
| `1.0` | Full ancestor path string embedding only |
| `0.0–1.0` | Blend: `score = (1-w)*leaf_score + w*path_score` |

When `path_weight` is set, both leaf and path collections are queried (top k×4 pool each), scores are blended, then re-sorted and trimmed to `top_k`.

### Indexing (done once at ingest time)
Three ChromaDB collections are populated:
- `hts_entries` — avg(leaf, path) embeddings
- `hts_entries_leaf` — leaf description embeddings
- `hts_entries_path` — path string embeddings

### Cost
Embedding only — no LLM call. Approximate: `$0.000025 / 1K chars` for the query. Tracked in `cost_usd`.

### Intermediates logged
- `query_embedding_norm` — sanity check on query vector quality
- `embedding_dim` — should be 768 for text-embedding-005
- `mode` — `"avg"` or `"weighted"`
- `path_weight` — if weighted mode
- `raw_scores` — cosine similarity for each result

### When to use
Fast and cheap. Good baseline. Works best when the query description is semantically close to HTS language. The frontend always uses `path_weight=1.0` (full ancestor path embedding).

---

## Method 2: LLM Rerank (`rerank`)

**File:** `hts_classifier/classifiers/rerank.py`

### How it works
Two-stage: broad retrieval, then precise ranking.

1. **Retrieval**: Embed the query and fetch `candidate_pool` candidates from ChromaDB (default 20)
2. **Reranking**: Show all candidates to Gemini Flash Lite with the original query. Ask it to rerank by relevance. Return top-k from the reranked list.

### Configuration
- `candidate_pool`: number of candidates retrieved before reranking (default 20, settable via API)

### Cost
One embedding call + one LLM call. Both tracked in `cost_usd`.

### Why this works better than embeddings alone
Embedding retrieval has good *recall* (right answer usually in top 20) but imperfect *precision* (top 1 isn't always correct). The LLM reranker applies deeper reasoning to promote the genuinely best match.

### Intermediates logged
- `candidate_pool`: number of candidates retrieved
- `initial_ranking`: original embedding scores before reranking
- `llm_raw_response`: raw LLM output before parsing
- `reranked_ranking`: final HTS codes in reranked order

### When to use
When you want the best accuracy and can afford one extra LLM call. Good default for production use.

---

## Method 3: GAR — Generative Augmented Retrieval (`gar`)

**File:** `hts_classifier/classifiers/gar.py`

### How it works
1. Send the query to Gemini Flash Lite with a prompt asking for 5 alternative HTS-style search phrases
2. Combine the original query + all expanded terms into one token bag
3. Run BM25 (Okapi BM25) against all `path_string` values in the flat entries index
4. Return top-k by BM25 score, normalized to 0–1

### Why BM25 (not embeddings) for GAR
The LLM is generating *trade terminology* — exact words likely to appear in HTS descriptions. BM25 rewards exact token overlap, which is precisely what we want here. Embeddings would dilute specificity with semantic similarity.

### Cost
One LLM call. Token counts and cost tracked in `cost_usd` via `usage_metadata`.

### Intermediates logged
- `expanded_terms` — the list of terms the LLM generated
- `llm_raw_response` — raw LLM output before parsing
- `bm25_scores` — raw and normalized BM25 score per result

### When to use
When the query uses consumer/colloquial language and the target HTS descriptions use trade terminology. Example: "iPhone" → "telephone sets for cellular networks".

---

## Method 4: Agentic (`agentic`) — backend only, not in frontend UI

**File:** `hts_classifier/classifiers/agentic.py`

See [docs/agentic_search.md](agentic_search.md) for full design notes.

### How it works
Layer-by-layer HTS tree traversal with LLM **explore/finalize** decisions at each level:

1. **Chapter selection**: LLM sees all ~99 chapters, picks `beam_width` to explore
2. **Explore/finalize loop** (up to depth 12):
   - Show all current beam nodes to LLM (unfiltered if ≤50; embedding-prefiltered if >50)
   - LLM returns `{"explore": [...], "finalize": [...]}` — 1-indexed
   - Explored nodes: expand children into next beam
   - Finalized nodes: add to `final_pool` (even if they have subcodes)
   - Leaves marked explore: auto-finalized
3. **Final ranking**: if `final_pool > top_k`, one more LLM call to pick the best `top_k`

### Configuration
- `beam_width`: chapters selected at step 1; soft target for explore count per step (default: 3, set via API or `.env BEAM_WIDTH`)
- `top_k`: final result count

### Cost
Multiple LLM calls (typically 4–8) plus occasional embedding prefilter call. Full cost tracked in `cost_usd`. Typical range: $0.001–0.010 per query.

### Intermediates logged
`beam_steps`: list of per-depth dicts with `step`, `beam_size`, `explored`, `finalized`, `llm_response`

### When to use
Complex or ambiguous descriptions where navigating the hierarchy matters. Most expensive but most interpretable — full audit trail of which branches were explored.

---

## API parameters

```json
POST /classify
{
  "description": "16 inch MacBook Pro",
  "method": "embeddings",       // "embeddings" | "rerank" | "gar" | "agentic"
  "top_k": 5,
  "path_weight": null,          // embeddings only: 0.0–1.0 or null (frontend always sends 1.0)
  "candidate_pool": null,       // rerank only: retrieval pool size (default 20)
  "beam_width": null            // agentic only (backend API): overrides BEAM_WIDTH env var
}
```

Warnings are logged (but not errors) if method-specific parameters are sent with the wrong method.

## Response shape

```json
{
  "results": [
    {
      "hts_code": "8471.30.01",
      "description": "Portable automatic data processing machines...",
      "path": ["Chapter 84", "8471", "8471.30", "8471.30.01"],
      "score": 0.91,
      "general_rate": "Free"
    }
  ],
  "method": "embeddings",
  "query": "16 inch MacBook Pro",
  "cost_usd": 0.0000023,
  "elapsed_ms": 312.4,
  "intermediates": { ... }
}
```

`elapsed_ms` is wall-clock time in milliseconds measured server-side around the `classifier.classify()` call (excludes FastAPI routing and serialization overhead).
```

## Comparison

| | Display name | Speed | LLM calls | Cost (approx) | Best for | Frontend |
|---|---|---|---|---|---|---|
| `embeddings` | Basic Semantic Search | Fast | 0 | <$0.00001 | Quick baseline, high volume | ✓ |
| `rerank` | LLM Rerank | Medium | 1 | ~$0.0002 | Best single-call accuracy | ✓ |
| `gar` | GAR | Medium | 1 | ~$0.0001 | Consumer terms → trade language | ✓ |
| `agentic` | — | Slow | 4–8 | $0.001–0.010 | Complex/ambiguous, needs audit trail | API only |
