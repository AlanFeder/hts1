# Agentic Search — Design Notes

## Overview

The agentic classifier navigates the HTS tree level-by-level using an LLM to make explore/finalize decisions at each layer. Unlike pure beam search (which commits greedily and discards siblings), the agentic approach explicitly separates "go deeper here" from "this is already the right answer."

---

## Algorithm

### Step 1: Chapter selection
All ~99 HTS chapters are shown to the LLM with 3 sample descriptions each. The LLM picks the `beam_width` most relevant chapters (default: 3). This is the only step that is truly exhaustive — the LLM sees all 99 options.

### Step 2+: Layer-by-layer explore/finalize loop

At each depth, the current **beam** (set of nodes under consideration) is shown to the LLM. The LLM returns two lists:

```json
{"explore": [2, 5], "finalize": [8]}
```

- **explore**: go deeper — expand this node's children into the next beam
- **finalize**: accept this as the answer — add to `final_pool` (even if subcodes exist)
- **omit** (not listed in either): prune from consideration

Leaves (nodes with no children) are tagged `[LEAF]` in the prompt and can only be finalized or omitted. If a leaf is marked `explore`, it is auto-finalized instead.

The loop continues until the beam is empty (no more nodes to explore) or depth 12 is reached (safety limit).

### Soft display cap

When the beam exceeds `_MAX_DISPLAY = 50` nodes (common at depth 0, when all heading nodes from 3 chapters are dumped into the beam), an **embedding prefilter** narrows it before the LLM call:

1. Embed the query with `RETRIEVAL_QUERY` task type
2. Embed all beam node texts (`path + description`) with `RETRIEVAL_DOCUMENT`
3. Compute cosine similarity, keep top 50

This uses the same embedding model as Method 1. The cost is tracked in `cost_usd`.

### Final ranking

Once the loop completes, `final_pool` contains all finalized nodes (from any depth). If `len(final_pool) > top_k`, a final LLM call ranks them and selects the best `top_k`. If `final_pool ≤ top_k`, they are returned as-is.

---

## Why explore/finalize instead of pure beam search

Pure beam search (original design) had two problems:

1. **BM25 prefilter at every step** was a silent second gate that could eliminate the correct node before the LLM saw it
2. **Greedy selection** — once you commit to `beam_width` nodes, siblings are gone forever

The explore/finalize design:
- LLM sees **all** beam nodes (unfiltered below 50, embedding-filtered above 50)
- Allows stopping early at a higher-level code when that's actually correct
- Accumulates finalized nodes across depths — even nodes finalized at depth 1 can be in the final answer

---

## Configuration

| Parameter | Source | Default | Effect |
|---|---|---|---|
| `beam_width` | API or `.env BEAM_WIDTH` | 3 | How many chapters selected; how many nodes marked explore at each step |
| `top_k` | API | 5 | Number of final results returned |

`beam_width` is a soft target — the LLM decides how many to explore/finalize and may return more or fewer.

---

## Cost structure

Each request makes several LLM calls (all `gemini-3-flash-preview` with `thinking_level="low"`):

| Call | Tokens (approx) | When |
|---|---|---|
| Chapter selection | ~2k input, ~20 output | Always (1×) |
| Embedding prefilter | character-based | Only if beam > 50 |
| Explore/finalize step | ~1–5k input, ~50 output | Once per depth (typically 3–6×) |
| Final ranking | ~1–2k input, ~20 output | Only if final_pool > top_k |

Typical total: **$0.001–0.010** per query at flash-lite pricing. Tracked in `cost_usd` field of the response.

---

## Intermediates

`intermediates.beam_steps` is a list of dicts, one per step:

```json
[
  {
    "step": "chapter_selection",
    "selected": ["85", "84"],
    "llm_response": "..."
  },
  {
    "step": "depth_0",
    "beam_size": 45,
    "explored": ["[8517] Telephone sets..."],
    "finalized": [],
    "llm_response": "..."
  },
  {
    "step": "final_ranking",
    "pool_size": 4,
    "selected": ["[8517.13] Smartphones..."],
    "llm_response": "..."
  }
]
```

This gives a full audit trail of which branches were explored and why.

---

## Known limitations

- **Chapter selection is still the critical gate**: if the right chapter isn't in the top `beam_width`, it's missed entirely. Wide `beam_width` (5–7) helps.
- **HTS vocabulary mismatch**: chapter descriptions are terse ("Electrical machinery and equipment..."). The embedding prefilter helps, but chapter-level selection remains the weakest link.
- **Multi-applicable products**: some products legitimately belong to multiple chapters (e.g., a heated car seat is both furniture and electrical). The LLM picks one branch; `rerank` may be better for these.
