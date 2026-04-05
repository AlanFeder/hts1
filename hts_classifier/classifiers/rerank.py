import json
import re

from loguru import logger

from ..core.models import ClassifyResponse, HTSResult
from ..services.vector_store import VectorStore
from ..services.vertex import embed_query, generate_text
from .base import BaseClassifier

_CANDIDATE_POOL = 20

_RERANK_PROMPT = """You are an HTS (Harmonized Tariff Schedule) tariff classification expert.

Product to classify: "{description}"

Below are candidate HTS codes retrieved by semantic search. Rerank them from most to least relevant.

Candidates:
{options}

Return ONLY a JSON array of the line numbers (1-indexed) in order of relevance, best match first.
Include all {n} candidates. Example: [3, 1, 7, 2, ...]"""


class RerankClassifier(BaseClassifier):
    """
    Method 4: Embeddings retrieval → LLM reranking.

    1. Embed the query and retrieve top-20 candidates from ChromaDB (cosine similarity).
    2. Pass all 20 to Gemini with the original description and ask it to rerank.
    3. Return the top_k from the reranked list.

    Combines the recall of semantic search with the precision of LLM reasoning.
    """

    def __init__(
        self, vector_store: VectorStore, candidate_pool: int = _CANDIDATE_POOL
    ) -> None:
        self._store = vector_store
        self._candidate_pool = candidate_pool

    async def classify(self, description: str, top_k: int = 5) -> ClassifyResponse:
        logger.info(
            "rerank | query=%r top_k=%d candidate_pool=%d",
            description,
            top_k,
            self._candidate_pool,
        )

        # Step 1: embedding retrieval
        embedding = await embed_query(description)
        candidates = self._store.query(embedding, top_k=self._candidate_pool)

        logger.info(
            "rerank | retrieved %d candidates from vector store", len(candidates)
        )
        for c in candidates:
            logger.debug(
                "rerank | initial score=%.4f hts=%s desc=%r",
                c["score"],
                c["hts_code"],
                c["description"],
            )

        initial_ranking = [
            {
                "rank": i + 1,
                "hts_code": c["hts_code"],
                "description": c["description"],
                "score": c["score"],
            }
            for i, c in enumerate(candidates)
        ]

        # Step 2: LLM reranking
        options = "\n".join(
            f"{i + 1}. [{c['hts_code']}] {c['description']} (path: {' > '.join(c['path'][-2:])})"
            for i, c in enumerate(candidates)
        )
        response = await generate_text(
            _RERANK_PROMPT.format(
                description=description,
                options=options,
                n=len(candidates),
            )
        )
        logger.debug("rerank | LLM rerank response: %s", response)

        # Parse reranked order
        reranked_indices: list[int] = []
        match = re.search(r"\[.*?\]", response, re.DOTALL)
        if match:
            try:
                reranked_indices = [int(x) for x in json.loads(match.group())]
            except (json.JSONDecodeError, ValueError):
                logger.warning(
                    "rerank | failed to parse LLM reranking response, using original order"
                )

        # Fall back to original order if parsing failed or incomplete
        seen = set(reranked_indices)
        for i in range(1, len(candidates) + 1):
            if i not in seen:
                reranked_indices.append(i)

        reranked = [
            candidates[i - 1] for i in reranked_indices if 0 < i <= len(candidates)
        ][:top_k]

        logger.info("rerank | final order: %s", [r["hts_code"] for r in reranked])

        return ClassifyResponse(
            results=[
                HTSResult(
                    hts_code=r["hts_code"],
                    description=r["description"],
                    path=r["path"],
                    score=1.0 / (rank + 1),
                    general_rate=r.get("general_rate"),
                )
                for rank, r in enumerate(reranked)
            ],
            method="rerank",
            query=description,
            intermediates={
                "candidate_pool": self._candidate_pool,
                "initial_ranking": initial_ranking,
                "llm_raw_response": response,
                "reranked_ranking": [
                    {
                        "rank": i + 1,
                        "hts_code": r["hts_code"],
                        "description": r["description"],
                        "original_score": r["score"],
                    }
                    for i, r in enumerate(reranked)
                ],
            },
        )
