import numpy as np
from loguru import logger

from ..core.models import ClassifyResponse, HTSResult
from ..services.vector_store import VectorStore
from ..services.vertex import embed_query
from .base import BaseClassifier


class EmbeddingsClassifier(BaseClassifier):
    def __init__(self, vector_store: VectorStore) -> None:
        self._store = vector_store

    async def classify(self, description: str, top_k: int = 5) -> ClassifyResponse:
        logger.info("embeddings | query=%r top_k=%d", description, top_k)

        embedding = await embed_query(description)
        norm = float(np.linalg.norm(embedding))
        logger.debug(
            "embeddings | query embedding norm=%.4f dim=%d", norm, len(embedding)
        )

        results = self._store.query(embedding, top_k=top_k)

        for r in results:
            logger.info(
                "embeddings | score=%.4f hts=%s desc=%r",
                r["score"],
                r["hts_code"],
                r["description"],
            )

        intermediates = {
            "query_embedding_norm": norm,
            "embedding_dim": len(embedding),
            "raw_scores": [
                {
                    "hts_code": r["hts_code"],
                    "description": r["description"],
                    "score": r["score"],
                }
                for r in results
            ],
        }

        return ClassifyResponse(
            results=[
                HTSResult(
                    hts_code=r["hts_code"],
                    description=r["description"],
                    path=r["path"],
                    score=r["score"],
                    general_rate=r.get("general_rate"),
                )
                for r in results
            ],
            method="embeddings",
            query=description,
            intermediates=intermediates,
        )
