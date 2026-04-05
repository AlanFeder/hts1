import asyncio

from google import genai
from google.genai.types import EmbedContentConfig

from ..core.config import settings

_client: genai.Client | None = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(
            vertexai=True,
            project=settings.google_cloud_project,
            location=settings.google_cloud_location,
        )
    return _client


def _embed_batch_sync(texts: list[str], task_type: str) -> list[list[float]]:
    response = get_client().models.embed_content(
        model=settings.embedding_model,
        contents=texts,
        config=EmbedContentConfig(task_type=task_type),
    )
    assert response.embeddings is not None
    return [e.values or [] for e in response.embeddings]


def _generate_sync(prompt: str) -> str:
    response = get_client().models.generate_content(
        model=settings.generation_model,
        contents=prompt,
    )
    return response.text or ""


async def embed_texts(
    texts: list[str],
    task_type: str = "RETRIEVAL_DOCUMENT",
) -> list[list[float]]:
    """Embed texts in batches. Use task_type='RETRIEVAL_QUERY' for queries."""
    loop = asyncio.get_event_loop()
    batch_size = settings.embedding_batch_size
    all_embeddings: list[list[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        embeddings = await loop.run_in_executor(None, _embed_batch_sync, batch, task_type)
        all_embeddings.extend(embeddings)

    return all_embeddings


async def embed_query(text: str) -> list[float]:
    results = await embed_texts([text], task_type="RETRIEVAL_QUERY")
    return results[0]


async def generate_text(prompt: str) -> str:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _generate_sync, prompt)
