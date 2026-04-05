# Classifier Mechanisms

All four methods share the same API contract (`POST /classify`) and return the same `ClassifyResponse` shape, including an `intermediates` field with all intermediate scores and LLM outputs.

---

## Method 1: Embeddings (`embeddings`)

**File:** `hts_classifier/classifiers/embeddings.py`

### How it works
1. Embed the query description using `text-embedding-005` with task type `RETRIEVAL_QUERY`
2. Query ChromaDB for the top-k nearest vectors by cosine similarity
3. Return results sorted by similarity score (0–1)

### Indexing (done once at ingest time)
Each HTS entry is stored as the **average** of two embeddings:
- `leaf_embedding`: embedding of the entry's own description
- `path_embedding`: embedding of the full ancestor path string (e.g. `"Machinery > Computers > Laptops"`)

Averaging gives the vector both specificity and hierarchical context.

### Intermediates logged
- `query_embedding_norm` — sanity check on query vector quality
- `embedding_dim` — should be 768 for text-embedding-005
- `raw_scores` — cosine similarity for each result

### When to use
Fast and cheap. Good baseline. Works best when the query description is semantically close to HTS language.

---

## Method 2: GAR — Generative Augmented Retrieval (`gar`)

**File:** `hts_classifier/classifiers/gar.py`

### How it works
1. Send the query to Gemini Flash Lite with a prompt asking for 5 alternative HTS-style search phrases
2. Combine the original query + all expanded terms into one token bag
3. Run BM25 (Okapi BM25) against all `path_string` values in the flat entries index
4. Return top-k by BM25 score, normalized to 0–1

### Why BM25 (not embeddings) for GAR
The LLM is generating *trade terminology* — exact words likely to appear in HTS descriptions. BM25 rewards exact token overlap, which is precisely what we want here. Embeddings would dilute specificity with semantic similarity.

### Intermediates logged
- `expanded_terms` — the list of terms the LLM generated
- `llm_raw_response` — raw LLM output before parsing
- `bm25_scores` — raw and normalized BM25 score per result

### When to use
When the query uses consumer/colloquial language and the target HTS descriptions use trade terminology. Example: "iPhone" → "telephone sets for cellular networks".

---

## Method 3: Agentic (`agentic`)

**File:** `hts_classifier/classifiers/agentic.py`

### How it works
Level-by-level beam search through the HTS chapter tree:

1. **Chapter selection**: Show the LLM all ~99 chapters (2-digit codes) with sample descriptions. Ask it to pick the `beam_width` most relevant chapters.
2. **Beam initialization**: Collect all indent=0 heading nodes from selected chapters. BM25-prefilter to ≤40 candidates.
3. **Beam expansion** (up to depth 12):
   - Show current beam candidates to LLM, ask it to pick `beam_width` most relevant
   - Expand each selected node's children
   - Repeat until all beam nodes are leaves (no children)
4. **Final ranking**: BM25-prefilter to top-k×2 candidates, ask LLM for final ordered ranking

BM25 pre-filtering at each step prevents the LLM prompt from growing unbounded when a node has many children.

### Configuration
- `beam_width`: number of candidates to keep at each level (default: 3, set in `.env` or config)

### Intermediates logged
- `beam_steps`: list of dicts, one per depth level, each containing:
  - `step`: `"chapter_selection"`, `"depth_0"`, ..., `"final_ranking"`
  - `candidates_count`: how many nodes were shown to LLM
  - `selected`: descriptions of selected nodes
  - `llm_response`: raw LLM output

### When to use
Complex or ambiguous descriptions where the correct code depends on navigating the hierarchy carefully. Most expensive (multiple LLM calls), but most interpretable — you can see exactly which branches were explored.

---

## Method 4: Rerank (`rerank`)

**File:** `hts_classifier/classifiers/rerank.py`

### How it works
Two-stage: broad retrieval, then precise ranking.

1. **Retrieval**: Embed the query and fetch top-20 candidates from ChromaDB (same as Method 1, but larger pool)
2. **Reranking**: Show all 20 candidates to Gemini Flash Lite with the original query. Ask it to rerank them from most to least relevant. Return top-k from the reranked list.

### Why this works better than embeddings alone
Embedding-based retrieval optimizes for semantic proximity in vector space — it has good *recall* (the right answer is usually in the top 20) but imperfect *precision* (the top 1 isn't always correct). The LLM reranker applies deeper reasoning about tariff classification nuance to promote the genuinely best match.

### Intermediates logged
- `candidate_pool`: number of candidates retrieved (default 20)
- `initial_ranking`: original embedding scores before reranking
- `llm_raw_response`: raw LLM output before parsing
- `reranked_order`: final HTS codes in reranked order

### When to use
When you want the best accuracy and can afford one extra LLM call. Good default for production use.

---

## Comparison

| | Speed | LLM calls | Accuracy | Interpretability |
|---|---|---|---|---|
| embeddings | Fast | 0 | Good | Low (just scores) |
| gar | Medium | 1 | Good for trade terms | Medium |
| agentic | Slow | 4–15 | High | High (full trace) |
| rerank | Medium | 1 | High | Medium |
