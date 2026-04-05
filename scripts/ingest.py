"""
One-time ingestion script: download HTS data, embed all entries, persist to ChromaDB.

Usage:
    uv run scripts/ingest.py                  # full ingest (resumes if interrupted)
    uv run scripts/ingest.py --limit 100      # test run: first 100 entries only
    uv run scripts/ingest.py --chapters 84,85 # test run: specific chapters only

Re-run whenever the HTS data is updated (delete data/hts_raw.json to force re-download).
Delete data/chroma to force re-embedding from scratch.
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
from hts_classifier.services.vector_store import (
    COLLECTION_AVG,
    COLLECTION_LEAF,
    COLLECTION_PATH,
    VectorStore,
)
from hts_classifier.services.vertex import embed_texts

# Number of entries to embed + upsert per chunk. Smaller = more resume granularity.
_CHUNK_SIZE = 2000


def _average_embeddings(a: list[float], b: list[float]) -> list[float]:
    return [(x + y) / 2 for x, y in zip(a, b)]


async def ingest_chunk(
    entries: list[HTSEntry],
    avg_store: VectorStore,
    leaf_store: VectorStore,
    path_store: VectorStore,
) -> None:
    """Embed one chunk and upsert into all three ChromaDB collections."""
    logger.info("  embedding leaf descriptions...")
    leaf_embeddings = await embed_texts(
        [e.description for e in entries],
        task_type="RETRIEVAL_DOCUMENT",
        show_progress=False,
    )
    logger.info("  embedding path strings...")
    path_embeddings = await embed_texts(
        [e.path_string for e in entries],
        task_type="RETRIEVAL_DOCUMENT",
        show_progress=False,
    )
    combined = [
        _average_embeddings(leaf, p)
        for leaf, p in zip(leaf_embeddings, path_embeddings)
    ]
    avg_store.upsert(entries, combined)
    leaf_store.upsert(entries, leaf_embeddings)
    path_store.upsert(entries, path_embeddings)


async def main(limit: int | None, chapters: list[str] | None) -> None:
    raw = fetch_hts_data(settings.hts_raw_path)
    logger.info(f"Loaded {len(raw):,} raw HTS entries")

    flat_entries, chapter_tree = build_tree_and_flat(raw)
    logger.info(
        f"Processed {len(flat_entries):,} entries with HTS codes across {len(chapter_tree)} chapters"
    )

    if chapters:
        flat_entries = [
            e for e in flat_entries if any(e.hts_code.startswith(ch) for ch in chapters)
        ]
        logger.info(f"Filtered to chapters {chapters}: {len(flat_entries):,} entries")

    if limit is not None:
        flat_entries = flat_entries[:limit]
        logger.info(f"Limiting to first {limit} entries for test run")

    is_test = limit is not None or chapters is not None
    processed_path = (
        settings.hts_processed_path if not is_test else "data/hts_processed_test.json"
    )

    save_flat_entries(flat_entries, processed_path)
    logger.info(f"Saved flat entries to {processed_path}")

    if is_test:
        import chromadb

        chroma_path = "data/chroma_test"
        client = chromadb.PersistentClient(path=chroma_path)
        collection = client.get_or_create_collection(
            "hts_entries", metadata={"hnsw:space": "cosine"}
        )

        already_indexed: set[str] = set(collection.get(include=[])["ids"])
        todo = [e for e in flat_entries if e.hts_code not in already_indexed]
        if already_indexed:
            logger.info(
                f"Resuming: {len(already_indexed):,} already indexed, {len(todo):,} remaining"
            )

        for i in tqdm(range(0, len(todo), _CHUNK_SIZE), desc="chunks"):
            chunk = todo[i : i + _CHUNK_SIZE]
            leaf_embs = await embed_texts(
                [e.description for e in chunk],
                task_type="RETRIEVAL_DOCUMENT",
                show_progress=False,
            )
            path_embs = await embed_texts(
                [e.path_string for e in chunk],
                task_type="RETRIEVAL_DOCUMENT",
                show_progress=False,
            )
            combined = [
                _average_embeddings(leaf, p) for leaf, p in zip(leaf_embs, path_embs)
            ]
            collection.upsert(
                ids=[e.hts_code for e in chunk],
                embeddings=combined,  # ty: ignore[invalid-argument-type]
                documents=[e.path_string for e in chunk],
                metadatas=[
                    {
                        "hts_code": e.hts_code,
                        "description": e.description,
                        "path": " | ".join(e.path),
                        "indent": e.indent,
                        "general_rate": e.general_rate,
                    }
                    for e in chunk
                ],
            )
        logger.info(
            f"Test ChromaDB at '{chroma_path}' now contains {collection.count():,} entries"
        )
    else:
        avg_store = VectorStore(COLLECTION_AVG)
        leaf_store = VectorStore(COLLECTION_LEAF)
        path_store = VectorStore(COLLECTION_PATH)

        already_indexed: set[str] = set(avg_store.get_all_ids())
        todo = [e for e in flat_entries if e.hts_code not in already_indexed]
        if already_indexed:
            logger.info(
                f"Resuming: {len(already_indexed):,} already indexed, {len(todo):,} remaining"
            )

        for i in tqdm(range(0, len(todo), _CHUNK_SIZE), desc="chunks"):
            chunk = todo[i : i + _CHUNK_SIZE]
            logger.info(
                f"Chunk {i // _CHUNK_SIZE + 1}: embedding {len(chunk):,} entries..."
            )
            await ingest_chunk(chunk, avg_store, leaf_store, path_store)

        logger.info(f"ChromaDB now contains {avg_store.count:,} entries")

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
