# HTS JSON Processing

## Raw data structure

Source: `https://www.usitc.gov/sites/default/files/tata/hts/hts_2026_revision_4_json.json`

The file is a **flat JSON array** of 35,733 objects. Each object represents one row in the tariff schedule. Fields:

| Field | Type | Notes |
|---|---|---|
| `htsno` | string | HTS code, e.g. `"0101.21.00"`. Empty for structural parent rows. |
| `indent` | string | Depth in hierarchy: `"0"` through `"11"`. Occasionally zero-padded (`"03"`). |
| `description` | string | Human-readable description of the category or product. |
| `superior` | `"true"` or null | Marks structural parent rows (no rate, no code). |
| `general` | string | General tariff duty rate, e.g. `"Free"`, `"4.5%"`. Empty for non-leaf rows. |
| `special` | string | Special trade agreement rates. |
| `other` | string | Column 2 (non-MFN) rate. |
| `units` | array | Measurement units, e.g. `["No.", "kg"]`. |
| `footnotes` | array | Endnotes referencing other provisions. |

The hierarchy is **not nested in the JSON** — it is encoded via the `indent` value. Indent 0 is a chapter heading; indent 11 is the most specific leaf.

## Path-building algorithm

We reconstruct the hierarchy using a **rolling path stack** — a dict mapping indent level to the description at that level.

```python
path_stack: dict[int, str] = {}

for item in raw:
    indent = int(item["indent"])          # cast: "03" → 3
    desc = item["description"].strip()

    path_stack[indent] = desc             # set current level
    for k in list(path_stack):            # prune deeper levels
        if k > indent:
            del path_stack[k]

    full_path = [path_stack[k] for k in sorted(path_stack)]
    # full_path is now the complete ancestor chain from root to this node
```

### Example (Live Horses section)

Raw JSON (three consecutive rows):

```json
{"indent": "0", "htsno": "0101", "description": "Live horses, asses, mules and hinnies:"}
{"indent": "1", "htsno": "",     "description": "Horses:", "superior": "true"}
{"indent": "2", "htsno": "0101.21.00", "description": "Purebred breeding animals", "general": "Free"}
```

Path stack evolution:

```
After indent=0:  {0: "Live horses, asses, mules and hinnies:"}
After indent=1:  {0: "Live horses, asses, mules and hinnies:", 1: "Horses:"}
After indent=2:  {0: "Live horses, asses, mules and hinnies:", 1: "Horses:", 2: "Purebred breeding animals"}
```

Resulting `path_string` for `0101.21.00`:

```
Live horses, asses, mules and hinnies: > Horses: > Purebred breeding animals
```

### When the indent goes back up

If the next row has `indent=1` again (a new sub-category like "Asses"), keys `> 1` are deleted:

```
Before: {0: "...", 1: "Horses:", 2: "Purebred breeding animals"}
After:  {0: "...", 1: "Asses:"}
```

This correctly represents the new branch without cross-contamination.

## Output: HTSEntry (flat list)

Only entries with a non-empty `htsno` become `HTSEntry` objects. Structural parent rows (empty `htsno`, `superior: "true"`) are used to build paths but are not stored in the embeddings index.

- Total raw rows: 35,733
- Entries with real HTS codes: **29,807** (~83%)
- Dropped rows: ~5,926 structural headings (section titles, chapter headings, `superior` rows)

Each `HTSEntry` has:
- `hts_code` — the dot-formatted HTS number
- `description` — the leaf description
- `indent` — depth (0–11)
- `path` — list of ancestor descriptions (including self)
- `path_string` — `" > ".join(path)` — used as the document for BM25 and embeddings
- `general_rate` — duty rate string

## Output: HTSNode (chapter tree)

For the agentic classifier, we also build a tree using a **parent node stack**. Each node holds a `children` list. The tree is rebuilt at server startup from the cached `hts_raw.json` (fast, O(n)).

Chapters are grouped by 2-digit prefix (e.g. chapter `"84"` = Nuclear reactors, boilers, machinery). 98 chapters total.

## Embedding strategy

Three ChromaDB collections are written at ingest time:

| Collection | Embedding | Purpose |
|---|---|---|
| `hts_entries` | avg(leaf, path) | Default query — balanced specificity + context |
| `hts_entries_leaf` | leaf description only | Weighted blending when `path_weight` < 1 |
| `hts_entries_path` | full path string only | Weighted blending when `path_weight` > 0 |

All use task type `RETRIEVAL_DOCUMENT`. Queries use `RETRIEVAL_QUERY`.

The `path_weight` request parameter (0.0–1.0) controls blending at query time:
- `null` → query `hts_entries` (avg) directly — fastest
- `0.0`–`1.0` → query both leaf + path collections, blend: `score = (1-w)*leaf_score + w*path_score`

## Caching

| Artifact | Path | When created |
|---|---|---|
| Raw JSON | `data/hts_raw.json` | First call to `fetch_hts_data()` |
| Flat entries | `data/hts_processed.json` | First call to `load_or_process()` or `ingest.py` |
| Embeddings | `data/chroma/` | `ingest.py` run |

Delete a file to force re-creation. The raw download is ~15MB; full ingest takes ~10–20 min (sequential API calls, resumable).
