import numpy as np
from loguru import logger

from ..core.models import ClassifyResponse, HTSResult
from ..services.vector_store import VectorStore
from ..services.vertex import embed_cost, embed_query
from .base import BaseClassifier


class EmbeddingsClassifier(BaseClassifier):
    def __init__(
        self,
        avg_store: VectorStore,
        leaf_store: VectorStore,
        path_store: VectorStore,
    ) -> None:
        self._avg_store = avg_store
        self._leaf_store = leaf_store
        self._path_store = path_store

    async def classify(
        self,
        description: str,
        top_k: int = 5,
        path_weight: float | None = None,
        candidate_pool: int | None = None,
        beam_width: int | None = None,
        num_terms: int | None = None,
    ) -> ClassifyResponse:
        logger.info(
            f"embeddings | query={description!r} top_k={top_k} path_weight={path_weight}"
        )

        embedding = await embed_query(description)
        norm = float(np.linalg.norm(embedding))
        logger.debug(
            f"embeddings | query embedding norm={norm:.4f} dim={len(embedding)}"
        )

        if path_weight is None:
            results = self._avg_store.query(embedding, top_k=top_k)
            blend_info: dict = {"mode": "avg"}
        else:
            # Query both collections with a larger pool, then blend scores
            pool = max(top_k * 4, 20)
            leaf_results = self._leaf_store.query(embedding, top_k=pool)
            path_results = self._path_store.query(embedding, top_k=pool)

            leaf_scores = {r["hts_code"]: r for r in leaf_results}
            path_scores = {r["hts_code"]: r for r in path_results}

            all_codes = set(leaf_scores) | set(path_scores)
            blended: list[dict] = []
            for code in all_codes:
                ls = leaf_scores[code]["score"] if code in leaf_scores else 0.0
                ps = path_scores[code]["score"] if code in path_scores else 0.0
                entry = (leaf_scores if code in leaf_scores else path_scores)[code]
                blended.append(
                    {**entry, "score": (1 - path_weight) * ls + path_weight * ps}
                )

            blended.sort(key=lambda x: x["score"], reverse=True)
            results = blended[:top_k]
            blend_info = {"mode": "weighted", "path_weight": path_weight}

        for r in results:
            logger.info(
                f"embeddings | score={r['score']:.4f} hts={r['hts_code']} desc={r['description']!r}"
            )

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
            cost_usd=embed_cost([description]),
            intermediates={
                "query_embedding_norm": norm,
                "embedding_dim": len(embedding),
                **blend_info,
                "raw_scores": [
                    {
                        "hts_code": r["hts_code"],
                        "description": r["description"],
                        "score": r["score"],
                    }
                    for r in results
                ],
            },
        )
