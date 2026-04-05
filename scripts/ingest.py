"""
One-time ingestion script: download HTS data, embed all entries, persist to ChromaDB.

Usage:
    uv run scripts/ingest.py                  # full ingest
    uv run scripts/ingest.py --limit 100      # test run: first 100 entries only
    uv run scripts/ingest.py --chapters 84,85 # test run: specific chapters only

Re-run whenever the HTS data is updated (delete data/hts_raw.json to force re-download).
Delete data/chroma to force re-embedding.
"""

import argparse
import asyncio
import sys
from pathlib import Path

from loguru import logger

sys.path.insert(0, str(Path(__file__).parent.parent))

from tqdm import tqdm

from hts_classifier.core.config import settings
from hts_classifier.data.loader import fetch_hts_data
from hts_classifier.data.processor import (
    HTSEntry,
    build_tree_and_flat,
    save_flat_entries,
)
from hts_classifier.services.vector_store import VectorStore
from hts_classifier.services.vertex import embed_texts


def _average_embeddings(a: list[float], b: list[float]) -> list[float]:
    return [(x + y) / 2 for x, y in zip(a, b)]


async def embed_entries(entries: list[HTSEntry]) -> list[list[float]]:
    """
    Embed each entry as the average of leaf description and full path string.
    Balances specificity (leaf) with hierarchy context (path).
    """
    logger.info(f"Embedding {len(entries):,} entries (2 passes: leaf + path)...")

    logger.info("  Pass 1/2: leaf descriptions")
    leaf_embeddings = await embed_texts(
        [e.description for e in entries], task_type="RETRIEVAL_DOCUMENT"
    )

    logger.info("  Pass 2/2: path strings")
    path_embeddings = await embed_texts(
        [e.path_string for e in entries], task_type="RETRIEVAL_DOCUMENT"
    )

    combined = [
        _average_embeddings(leaf, p)
        for leaf, p in zip(leaf_embeddings, path_embeddings)
    ]
    logger.info(f"  Done. Embedding dim: {len(combined[0])}")
    return combined


async def main(limit: int | None, chapters: list[str] | None) -> None:
    raw = fetch_hts_data(settings.hts_raw_path)
    logger.info(f"Loaded {len(raw):,} raw HTS entries")

    flat_entries, chapter_tree = build_tree_and_flat(raw)
    logger.info(
        f"Processed {len(flat_entries):,} entries with HTS codes across {len(chapter_tree)} chapters"
    )

    # Filter to specific chapters if requested
    if chapters:
        flat_entries = [
            e for e in flat_entries if any(e.hts_code.startswith(ch) for ch in chapters)
        ]
        logger.info(f"Filtered to chapters {chapters}: {len(flat_entries):,} entries")

    # Hard limit for quick testing
    if limit is not None:
        flat_entries = flat_entries[:limit]
        logger.info(f"Limiting to first {limit} entries for test run")

    is_test = limit is not None or chapters is not None
    processed_path = (
        settings.hts_processed_path if not is_test else "data/hts_processed_test.json"
    )
    chroma_path = settings.chroma_path if not is_test else "data/chroma_test"

    save_flat_entries(flat_entries, processed_path)
    logger.info(f"Saved flat entries to {processed_path}")

    embeddings = await embed_entries(flat_entries)

    logger.info("Upserting into ChromaDB...")
    # Override chroma path for test runs
    if is_test:
        import chromadb

        client = chromadb.PersistentClient(path=chroma_path)
        collection = client.get_or_create_collection(
            "hts_entries", metadata={"hnsw:space": "cosine"}
        )
        batch_size = 500
        for i in tqdm(range(0, len(flat_entries), batch_size)):
            batch_e = flat_entries[i : i + batch_size]
            batch_emb = embeddings[i : i + batch_size]
            collection.upsert(
                ids=[e.hts_code for e in batch_e],
                embeddings=batch_emb,  # ty: ignore[invalid-argument-type]
                documents=[e.path_string for e in batch_e],
                metadatas=[
                    {
                        "hts_code": e.hts_code,
                        "description": e.description,
                        "path": " | ".join(e.path),
                        "indent": e.indent,
                        "general_rate": e.general_rate,
                    }
                    for e in batch_e
                ],
            )
        logger.info(
            f"Test ChromaDB at '{chroma_path}' now contains {collection.count():,} entries"
        )
    else:
        store = VectorStore()
        batch_size = 500
        for i in tqdm(range(0, len(flat_entries), batch_size)):
            store.upsert(
                flat_entries[i : i + batch_size], embeddings[i : i + batch_size]
            )
        logger.info(f"ChromaDB now contains {store.count:,} entries")

    logger.info("Ingestion complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest HTS data into ChromaDB")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only embed the first N entries (for testing)",
    )
    parser.add_argument(
        "--chapters",
        type=str,
        default=None,
        help="Comma-separated 2-digit chapter codes to ingest (e.g. '84,85')",
    )
    args = parser.parse_args()
    chapter_list = (
        [c.strip().zfill(2) for c in args.chapters.split(",")]
        if args.chapters
        else None
    )

    asyncio.run(main(limit=args.limit, chapters=chapter_list))
