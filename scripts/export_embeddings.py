"""
One-time export: ChromaDB → binary files for Node.js in-memory vector store.

Writes per collection (avg / leaf / path):
  data/embeddings_{name}.bin   — uint32 N, uint32 dim, then N*dim float32 (little-endian)
  data/embeddings_{name}_meta.json — parallel array of {hts_code, description, path, indent, general_rate}

Run once after ingest:
  uv run scripts/export_embeddings.py
"""

import json
import struct
from pathlib import Path

import chromadb
import numpy as np
from loguru import logger

CHROMA_PATH = "data/chroma"
OUTPUT_DIR = Path("data")

COLLECTIONS = {
    "avg": "hts_entries",
    "leaf": "hts_entries_leaf",
    "path": "hts_entries_path",
}


def export_collection(client: chromadb.PersistentClient, name: str, collection_name: str) -> None:
    logger.info(f"Exporting collection '{collection_name}'…")
    col = client.get_collection(collection_name)
    total = col.count()
    logger.info(f"  {total:,} entries")

    # Fetch all in one shot (ChromaDB loads into RAM anyway)
    result = col.get(include=["embeddings", "metadatas"])  # type: ignore[list-item]

    embeddings: list[list[float]] = result["embeddings"]  # type: ignore[assignment]
    metadatas: list[dict] = result["metadatas"]  # type: ignore[assignment]

    N = len(embeddings)
    dim = len(embeddings[0])
    logger.info(f"  N={N:,}  dim={dim}")

    # ── Binary embeddings file ─────────────────────────────────────────────
    arr = np.array(embeddings, dtype=np.float32)  # shape (N, dim)
    bin_path = OUTPUT_DIR / f"embeddings_{name}.bin"
    with open(bin_path, "wb") as f:
        f.write(struct.pack("<II", N, dim))  # 8-byte header
        f.write(arr.tobytes())
    logger.info(f"  → {bin_path} ({bin_path.stat().st_size / 1024 / 1024:.1f} MB)")

    # ── Metadata JSON ──────────────────────────────────────────────────────
    meta = [
        {
            "hts_code": str(m.get("hts_code", "")),
            "description": str(m.get("description", "")),
            "path": str(m.get("path", "")).split(" | "),
            "indent": int(m.get("indent", 0)),
            "general_rate": str(m.get("general_rate", "")),
        }
        for m in metadatas
    ]
    meta_path = OUTPUT_DIR / f"embeddings_{name}_meta.json"
    meta_path.write_text(json.dumps(meta, separators=(",", ":")))
    logger.info(f"  → {meta_path} ({meta_path.stat().st_size / 1024 / 1024:.1f} MB)")


def main() -> None:
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    for name, collection_name in COLLECTIONS.items():
        export_collection(client, name, collection_name)
    logger.info("Export complete. Run `npm run dev` to start the Node.js server.")


if __name__ == "__main__":
    main()
