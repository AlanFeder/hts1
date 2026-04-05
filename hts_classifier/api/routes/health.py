from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    indexed_entries: int


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    store = request.app.state.vector_store
    return HealthResponse(status="ok", indexed_entries=store.count)
