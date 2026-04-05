from fastapi import APIRouter, HTTPException, Request

from ...core.models import ClassifyRequest, ClassifyResponse

router = APIRouter()


@router.post("/classify", response_model=ClassifyResponse)
async def classify(body: ClassifyRequest, request: Request) -> ClassifyResponse:
    classifiers = request.app.state.classifiers
    classifier = classifiers.get(body.method)
    if classifier is None:
        raise HTTPException(status_code=400, detail=f"Unknown method: {body.method}")
    return await classifier.classify(
        body.description, body.top_k, path_weight=body.path_weight
    )
