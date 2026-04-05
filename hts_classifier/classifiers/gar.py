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

Given a product description, generate 5 alternative search phrases that could help find this product in the HTS. Include technical/trade terms, material composition, function, and industry sector.

Product description: {description}

Respond with ONLY a JSON array of strings, no explanation.
Example: ["smartphones", "mobile phones", "telephone handsets", "wireless communication devices", "cellular telephones"]"""


class GARClassifier(BaseClassifier):
    def __init__(self, entries: list[HTSEntry]) -> None:
        tokenized = [e.path_string.lower().split() for e in entries]
        self._bm25 = BM25Okapi(tokenized)
        self._entries = entries

    async def classify(self, description: str, top_k: int = 5) -> ClassifyResponse:
        logger.info("gar | query=%r top_k=%d", description, top_k)

        response = await generate_text(_PROMPT.format(description=description))
        logger.debug("gar | raw LLM response: %s", response)

        expanded_terms: list[str] = [description]
        match = re.search(r"\[.*?\]", response, re.DOTALL)
        if match:
            try:
                expanded_terms += json.loads(match.group())
            except (json.JSONDecodeError, ValueError):
                logger.warning("gar | failed to parse expanded terms from LLM response")

        logger.info("gar | expanded_terms=%s", expanded_terms)

        combined_query = " ".join(expanded_terms).lower().split()
        scores = self._bm25.get_scores(combined_query)

        top_indices = np.argsort(scores)[::-1][:top_k]
        max_score = float(scores[top_indices[0]]) if scores[top_indices[0]] > 0 else 1.0

        for i in top_indices:
            logger.info(
                "gar | bm25_score=%.4f (norm=%.4f) hts=%s desc=%r",
                float(scores[i]),
                float(scores[i]) / max_score,
                self._entries[i].hts_code,
                self._entries[i].description,
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
            intermediates=intermediates,
        )
