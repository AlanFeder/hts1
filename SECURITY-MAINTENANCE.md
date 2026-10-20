# Dependency and vector-store maintenance

Install the Python runtime with `uv sync --frozen --all-groups`. The frontend uses Node 24.12+ and `npm ci`; `npm run build` produces the same app using Vite 8 and Tailwind 4.

ChromaDB has advisories without a patched release. SQLite/NumPy now stores local embeddings in `data/vectors` with the same collection names, metadata and cosine score (`1 - distance`) used by the classifier. Retrieval scans all local vectors per query. This is appropriate for the local taxonomy, but does not provide Chroma server/scaling features.

Back up existing data before deployment. Copy recoverable collections with:

```sh
uv run python scripts/migrate_legacy_vectors.py --source data/chroma --destination data/vectors
```

Migration opens the source read-only and refuses collections whose compacted queues lack any live vector. For those collections restore an export or rerun ingestion; never delete the old index until the new one is verified. Ingestion can also create a fresh index using the configured Google embedding service.

CI tests persistence, ranking, migration, and HTS result shape without cloud credentials or paid requests, builds the frontend, and audits all Python/Node locked dependencies.
