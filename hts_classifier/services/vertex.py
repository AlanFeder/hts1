import asyncio
import threading
from typing import NamedTuple

from google import genai
from tqdm import tqdm
from google.genai.types import EmbedContentConfig, GenerateContentConfig, ThinkingConfig

from ..core.config import settings

# Thread-local storage: each executor thread gets its own client instance.
# A shared singleton is not safe when run_in_executor fires concurrent threads.
_thread_local = threading.local()

# text-embedding-005 limits: 250 instances per request, 20k tokens per request.
# Short HTS descriptions average ~2 chars/token, so 30k chars ≈ 15k tokens.
_MAX_CHARS_PER_BATCH = 30_000
_MAX_TEXTS_PER_BATCH = 250

# Approximate Vertex AI pricing (USD). Update if model changes.
# gemini-2.5-flash-lite: $0.10/1M input tokens, $0.40/1M output tokens
# text-embedding-005: $0.000025/1K characters
_PRICE_INPUT_PER_TOKEN = 0.10 / 1_000_000
_PRICE_OUTPUT_PER_TOKEN = 0.40 / 1_000_000
_PRICE_EMBED_PER_CHAR = 0.000025 / 1_000


class GenerateResult(NamedTuple):
    text: str
    input_tokens: int
    output_tokens: int

    @property
    def cost_usd(self) -> float:
        return (
            self.input_tokens * _PRICE_INPUT_PER_TOKEN
            + self.output_tokens * _PRICE_OUTPUT_PER_TOKEN
        )


def embed_cost(texts: list[str]) -> float:
    """Approximate embedding cost based on character count."""
    return sum(len(t) for t in texts) * _PRICE_EMBED_PER_CHAR


def get_client() -> genai.Client:
    if not hasattr(_thread_local, "client"):
        _thread_local.client = genai.Client(
            vertexai=True,
            project=settings.google_cloud_project,
            location=settings.google_cloud_location,
        )
    return _thread_local.client


def _embed_batch_sync(texts: list[str], task_type: str) -> list[list[float]]:
    response = get_client().models.embed_content(
        model=settings.embedding_model,
        contents=texts,
        config=EmbedContentConfig(task_type=task_type),
    )
    assert response.embeddings is not None
    return [e.values or [] for e in response.embeddings]


def _generate_sync(prompt: str, model: str | None = None, thinking_level: str | None = None) -> GenerateResult:
    kwargs = {
        "model": model or settings.generation_model,
        "contents": prompt,
    }
    if thinking_level:
        kwargs["config"] = GenerateContentConfig(
            thinking_config=ThinkingConfig(thinking_level=thinking_level)
        )
        
    response = get_client().models.generate_content(**kwargs)
    usage = response.usage_metadata
    return GenerateResult(
        text=response.text or "",
        input_tokens=getattr(usage, "prompt_token_count", 0) or 0,
        output_tokens=getattr(usage, "candidates_token_count", 0) or 0,
    )


def _make_batches(texts: list[str]) -> list[list[str]]:
    """Split texts into batches that stay within the token limit."""
    batches: list[list[str]] = []
    current: list[str] = []
    current_chars = 0
    for text in texts:
        n = len(text)
        if current and (
            current_chars + n > _MAX_CHARS_PER_BATCH
            or len(current) >= _MAX_TEXTS_PER_BATCH
        ):
            batches.append(current)
            current = [text]
            current_chars = n
        else:
            current.append(text)
            current_chars += n
    if current:
        batches.append(current)
    return batches


async def embed_texts(
    texts: list[str],
    task_type: str = "RETRIEVAL_DOCUMENT",
    show_progress: bool = False,
) -> list[list[float]]:
    """Embed texts with dynamic batching, sequential requests."""
    loop = asyncio.get_running_loop()
    batches = _make_batches(texts)
    results: list[list[float]] = []
    it = tqdm(batches, desc="batches") if show_progress else batches
    for batch in it:
        batch_result = await loop.run_in_executor(
            None, _embed_batch_sync, batch, task_type
        )
        results.extend(batch_result)
    return results


async def embed_query(text: str) -> list[float]:
    results = await embed_texts([text], task_type="RETRIEVAL_QUERY")
    return results[0]


async def generate_text(prompt: str, model: str | None = None, thinking_level: str | None = None) -> GenerateResult:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _generate_sync, prompt, model, thinking_level)
