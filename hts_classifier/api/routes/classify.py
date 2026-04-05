import time

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from ...core.models import ClassifyRequest, ClassifyResponse

router = APIRouter()

# Maps each param to the method(s) that use it
_PARAM_METHODS: dict[str, str] = {
    "path_weight": "embeddings",
    "candidate_pool": "rerank",
    "beam_width": "agentic",
}


@router.post("/classify", response_model=ClassifyResponse)
async def classify(body: ClassifyRequest, request: Request) -> ClassifyResponse:
    classifiers = request.app.state.classifiers
    classifier = classifiers.get(body.method)
    if classifier is None:
        raise HTTPException(status_code=400, detail=f"Unknown method: {body.method}")

    for param, intended_method in _PARAM_METHODS.items():
        value = getattr(body, param)
        if value is not None and body.method != intended_method:
            logger.warning(
                f"classify | {param}={value!r} has no effect for method={body.method!r} (only used by {intended_method!r})"
            )

    t0 = time.perf_counter()
    response = await classifier.classify(
        body.description,
        body.top_k,
        path_weight=body.path_weight,
        candidate_pool=body.candidate_pool,
        beam_width=body.beam_width,
    )
    response.elapsed_ms = (time.perf_counter() - t0) * 1000
    return response
