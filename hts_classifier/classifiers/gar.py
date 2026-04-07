import json
import re

import numpy as np
from loguru import logger
from rank_bm25 import BM25Okapi

from ..core.models import ClassifyResponse, HTSResult
from ..data.processor import HTSEntry
from ..services.vertex import generate_text
from .base import BaseClassifier

_PROMPT = """You are an expert in HTS (Harmonized Tariff Schedule) tariff classification.

Given a product description, generate {num_terms} alternative search phrases that could help find this product in the HTS. Include technical/trade terms, material composition, function, and industry sector.

Product description: {description}

Respond with ONLY a JSON array of strings, no explanation.
Example: ["smartphones", "mobile phones", "telephone handsets", "wireless communication devices", "cellular telephones"]"""

_DEFAULT_NUM_TERMS = 5


class GARClassifier(BaseClassifier):
    def __init__(self, entries: list[HTSEntry]) -> None:
        tokenized = [e.path_string.lower().split() for e in entries]
        self._bm25 = BM25Okapi(tokenized)
        self._entries = entries

    async def classify(
        self,
        description: str,
        top_k: int = 5,
        path_weight: float | None = None,
        candidate_pool: int | None = None,
        beam_width: int | None = None,
        num_terms: int | None = None,
    ) -> ClassifyResponse:
        n = num_terms or _DEFAULT_NUM_TERMS
        logger.info(f"gar | query={description!r} top_k={top_k} num_terms={n}")

        result = await generate_text(_PROMPT.format(description=description, num_terms=n))
        response = result.text
        logger.debug(
            f"gar | raw LLM response: {response} tokens={result.input_tokens}+{result.output_tokens} cost=${result.cost_usd:.6f}"
        )

        expanded_terms: list[str] = [description]
        match = re.search(r"\[.*?\]", response, re.DOTALL)
        if match:
            try:
                expanded_terms += json.loads(match.group())
            except (json.JSONDecodeError, ValueError):
                logger.warning("gar | failed to parse expanded terms from LLM response")

        logger.info(f"gar | expanded_terms={expanded_terms}")

        combined_query = " ".join(expanded_terms).lower().split()
        scores = self._bm25.get_scores(combined_query)

        top_indices = np.argsort(scores)[::-1][:top_k]
        max_score = float(scores[top_indices[0]]) if scores[top_indices[0]] > 0 else 1.0

        for i in top_indices:
            logger.info(
                f"gar | bm25_score={float(scores[i]):.4f} (norm={float(scores[i]) / max_score:.4f})"
                f" hts={self._entries[i].hts_code} desc={self._entries[i].description!r}"
            )

        intermediates = {
            "expanded_terms": expanded_terms,
            "llm_raw_response": response,
            "bm25_scores": [
                {
                    "hts_code": self._entries[i].hts_code,
                    "description": self._entries[i].description,
                    "raw_score": float(scores[i]),
                    "normalized_score": float(scores[i]) / max_score,
                }
                for i in top_indices
            ],
        }

        return ClassifyResponse(
            results=[
                HTSResult(
                    hts_code=self._entries[i].hts_code,
                    description=self._entries[i].description,
                    path=self._entries[i].path,
                    score=float(scores[i]) / max_score,
                    general_rate=self._entries[i].general_rate,
                )
                for i in top_indices
            ],
            method="gar",
            query=description,
            cost_usd=result.cost_usd,
            intermediates=intermediates,
        )
