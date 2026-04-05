from typing import Any, Literal

from pydantic import BaseModel


class ClassifyRequest(BaseModel):
    description: str
    method: Literal["embeddings", "gar", "agentic", "rerank"] = "embeddings"
    top_k: int = 5
    path_weight: float | None = (
        None  # embeddings only: 0.0=leaf-only, 1.0=path-only, None=avg
    )
    candidate_pool: int | None = (
        None  # rerank only: retrieval pool size before LLM rerank
    )
    beam_width: int | None = None  # agentic only: candidates kept at each tree level


class HTSResult(BaseModel):
    hts_code: str
    description: str
    path: list[str]
    score: float
    general_rate: str | None = None


class ClassifyResponse(BaseModel):
    results: list[HTSResult]
    method: str
    query: str
    cost_usd: float | None = None  # approximate Vertex AI cost for this request
    intermediates: dict[str, Any] | None = None
