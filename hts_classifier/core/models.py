from typing import Any, Literal

from pydantic import BaseModel


class ClassifyRequest(BaseModel):
    description: str
    method: Literal["embeddings", "gar", "agentic", "rerank"] = "embeddings"
    top_k: int = 5
    path_weight: float | None = (
        None  # embeddings only: 0.0=leaf-only, 1.0=path-only, None=avg
    )


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
    intermediates: dict[str, Any] | None = None
