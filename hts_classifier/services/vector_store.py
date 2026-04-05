from pathlib import Path

import chromadb

from ..core.config import settings
from ..data.processor import HTSEntry


# Collection names used during ingest and at query time
COLLECTION_AVG = "hts_entries"
COLLECTION_LEAF = "hts_entries_leaf"
COLLECTION_PATH = "hts_entries_path"


class VectorStore:
    def __init__(self, collection_name: str = COLLECTION_AVG) -> None:
        Path(settings.chroma_path).mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(path=settings.chroma_path)
        self._collection = self._client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    @property
    def count(self) -> int:
        return self._collection.count()

    def get_all_ids(self) -> list[str]:
        return self._collection.get(include=[])["ids"]

    def upsert(self, entries: list[HTSEntry], embeddings: list[list[float]]) -> None:
        self._collection.upsert(
            ids=[e.hts_code for e in entries],
            embeddings=embeddings,  # ty: ignore[invalid-argument-type]
            documents=[e.path_string for e in entries],
            metadatas=[
                {
                    "hts_code": e.hts_code,
                    "description": e.description,
                    "path": " | ".join(e.path),
                    "indent": e.indent,
                    "general_rate": e.general_rate,
                }
                for e in entries
            ],
        )

    def query(self, embedding: list[float], top_k: int = 5) -> list[dict]:
        results = self._collection.query(
            query_embeddings=[embedding],
            n_results=top_k,
            include=["metadatas", "distances"],
        )
        assert results["metadatas"] is not None and results["distances"] is not None
        items = []
        for meta, dist in zip(results["metadatas"][0], results["distances"][0]):
            items.append(
                {
                    "hts_code": meta["hts_code"],
                    "description": meta["description"],
                    "path": meta["path"].split(" | "),
                    "indent": meta["indent"],
                    "general_rate": meta.get("general_rate", ""),
                    "score": 1.0 - dist,  # cosine distance -> similarity
                }
            )
        return items
