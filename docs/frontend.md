# Frontend

A React single-page application for interacting with the HTS Classifier API. Built with Vite, TypeScript, and Tailwind CSS.

## Running

```bash
# Backend must be running first (port 8000)
uv run main.py

# Start the frontend (port 5173)
cd frontend
npm install   # first time only
npm run dev
```

Production build: `npm run build` → `frontend/dist/`

---

## Design

**Visual language:** Deep navy header evoking a federal agency context, white content cards on a slate background, gold accent for highlighting. Monospace fonts for HTS codes and scores. No decorative clutter.

**Disclaimer:** The header includes an amber "Unofficial tool · Not affiliated with USITC" notice with a link to the official USITC site. The footer credits "Developed by Alan Feder" and "Assisted by Claude Code and Antigravity".

**Non-indexable:** `frontend/public/robots.txt` disallows all crawlers; `index.html` includes `<meta name="robots" content="noindex, nofollow">`.

**Fonts:**
- Inter (UI text, labels)
- JetBrains Mono (HTS codes, scores, raw LLM output)

**Color system (Tailwind extensions):**

| Token | Role |
|---|---|
| `navy-*` | Header, primary buttons, HTS code badges |
| `gold-*` | Accent highlight (cost bars) |
| `blue-*` | Basic Semantic Search method, score bars, focus rings |
| `purple-*` | LLM Rerank method, reranked ranking cards |
| `emerald-*` | GAR method, BM25 bars |

Each of the four classification methods has a consistent color identity used across method selectors, result cards, bars, and intermediates panels.

---

## File Structure

```
frontend/
├── index.html                    Entry HTML (font imports, #root)
├── package.json
├── vite.config.ts                Dev proxy: /classify + /health → localhost:8000
├── tsconfig.json
├── tailwind.config.js            Custom colors + fonts
├── postcss.config.js
└── src/
    ├── main.tsx                  React root mount
    ├── index.css                 Tailwind directives + shared component classes
    ├── App.tsx                   Two-tab shell (Classify / Compare Methods)
    ├── types.ts                  All TypeScript types + METHOD_META constants
    ├── api.ts                    fetch wrapper for POST /classify
    └── components/
        ├── Header.tsx            Navy header bar + tab navigation
        ├── ClassifyForm.tsx      Description input, method selector, advanced params
        ├── ResultsTable.tsx      HTS results table (full + compact variants)
        ├── SingleView.tsx        Single-method classify flow
        ├── CompareView.tsx       Four-method parallel comparison
        └── intermediates/
            ├── IntermediatesPanel.tsx     Router — dispatches to method-specific panel
            ├── EmbeddingsIntermediates.tsx
            ├── GarIntermediates.tsx
            └── RerankIntermediates.tsx
```

---

## Tabs

### Classify (Single Method)

Three-step flow:

1. **Form** (`ClassifyForm`) — description textarea, method selector, advanced params, submit
2. **Results** (`ResultsTable`) — ranked HTS codes with scores, path, tariff rate
3. **Method Internals** (`IntermediatesPanel`) — method-specific debug panel

#### Method Selector

Four cards, one per method, in order: Basic Semantic Search, LLM Rerank, GAR, Agentic. Each shows:
- Method color dot
- Method label
- ⓘ icon — hover to reveal a 2-paragraph tooltip with a full explanation of the method
- Short tagline below the label

Selecting a method reveals its advanced parameter (if any):
- `rerank` → `candidate_pool` (default 20)

Embeddings always uses `path_weight=1` (full path) — no UI control exposed.

#### Results Table

| Column | Notes |
|---|---|
| # | 1-indexed rank |
| HTS Code | Navy badge, links to `https://hts.usitc.gov/search?query=<code>` |
| Description | Full HTS description text |
| Path | Full ancestor path as breadcrumb (all levels, hidden on small screens) |
| Score | Horizontal bar + numeric value (0–1) |
| Tariff | `general_rate` from HTS data |

A meta-chips row above the table shows: method, elapsed time (ms), cost (USD), result count.

---

### Compare Methods

Fires all four classifiers in parallel for a single description, then shows results side-by-side.

#### Summary Section

Appears as soon as any method responds. Shows:

**Performance bars** — one row per method:
- Elapsed time bar (scaled to slowest method)
- Cost bar (scaled to most expensive method)
- Numeric values in monospace
- Animated pulse while a method is still loading

**Top Result Table** — one row per method showing its #1 result (HTS code + description + score). Placeholder skeletons while loading.

#### Per-Method Cards (1×4 grid on large screens)

Each card has:
- Colored header (method color) showing method name, elapsed time, cost
- Compact results table (no tariff column; path shown inline below description)
- HTS code badges are linked to USITC
- Click the header to expand **Method Internals** inline

---

## Method Internals Panels

### Embeddings

- **Stat boxes**: embedding dimension, query vector norm, blend mode
- **Cosine similarity bars**: one bar per result, scaled to max score, with HTS code badge + description

### GAR + BM25

- **Expanded terms chips**: original query labeled "orig", LLM-generated terms in alternating colors (blue, emerald, purple, amber, rose, cyan)
- **BM25 score bars**: normalized scores, emerald color
- **Raw LLM response toggle**: collapsible, dark code block

### Rerank

- **Candidate pool stat box**
- **Side-by-side ranking comparison**:
  - Left: initial embedding ranking (score shown)
  - Right: after LLM rerank — shows rank movement indicator (`▲N` green / `▼N` red)
- **Raw LLM response toggle**

---

## State Management

No external state library — plain `useState` throughout.

**SingleView state machine:**
```
idle → loading → success | error
```

**CompareView state per method:**
```
idle → loading(startedAt) → success(data, clientMs) | error(message)
```

`clientMs` is measured with `performance.now()` client-side for latency display before server `elapsed_ms` arrives. Once the response arrives, server `elapsed_ms` (from the backend) is used preferentially.

---

## API Client

`src/api.ts` — thin `fetch` wrapper. No caching, no retry. Throws on non-2xx.

The Vite dev proxy forwards `/classify` and `/health` to `http://localhost:8000`, so no CORS header is needed during development. In production, the backend must serve CORS headers (already configured) or the frontend must be served from the same origin.

---

## Backend Changes Required by This Frontend

Two small additions were made to the Python backend when building this frontend:

### 1. `elapsed_ms` field

**File:** `hts_classifier/core/models.py`

```python
class ClassifyResponse(BaseModel):
    ...
    elapsed_ms: float | None = None   # ← added
    ...
```

**File:** `hts_classifier/api/routes/classify.py`

```python
t0 = time.perf_counter()
response = await classifier.classify(...)
response.elapsed_ms = (time.perf_counter() - t0) * 1000
return response
```

Wall-clock time in milliseconds for the full classify call, measured server-side.

### 2. CORS middleware

**File:** `hts_classifier/app.py`

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Allows the Vite dev server (5173) and preview server (4173) to call the API directly. Without this, browser requests would be blocked by CORS policy.

---

## Adding a New Method to the Frontend

1. **`src/types.ts`** — Add the method literal to `Method`, add an entry to `METHOD_META` with `label`, `color`, `bg`, `border`, `dot` Tailwind classes, and add a typed `*Intermediates` interface.
2. **`src/components/ClassifyForm.tsx`** — Add the method to `METHODS`, `METHOD_SHORT`, and `METHOD_TOOLTIP`. Add any method-specific param input in the advanced params block.
3. **`src/components/intermediates/`** — Create `YourMethodIntermediates.tsx`.
4. **`src/components/intermediates/IntermediatesPanel.tsx`** — Add a `case` for the new method.
5. **`src/components/CompareView.tsx`** — Add the method to `METHODS` and the initial `states` object.

The ResultsTable requires no changes — it is method-agnostic.
