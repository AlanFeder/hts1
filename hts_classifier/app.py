import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from .api.routes import classify, health
from .classifiers.agentic import AgenticClassifier
from .classifiers.embeddings import EmbeddingsClassifier
from .classifiers.gar import GARClassifier
from .classifiers.rerank import RerankClassifier
from .core.config import settings
from .data.loader import fetch_hts_data
from .data.processor import load_or_process
from .services.vector_store import COLLECTION_LEAF, COLLECTION_PATH, VectorStore
from .services.vertex import embed_query


def _configure_logging() -> None:
    logger.remove()
    logger.add(
        sys.stderr,
        level="DEBUG",
        format="<green>{time:HH:mm:ss}</green> <level>{level:<8}</level> <cyan>{name}</cyan> | {message}",
        colorize=True,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _configure_logging()

    if not Path(settings.chroma_path).exists():
        raise RuntimeError(
            f"ChromaDB not found at '{settings.chroma_path}'. "
            "Run `uv run scripts/ingest.py` first."
        )

    raw = fetch_hts_data(settings.hts_raw_path)
    logger.info("Loaded {:,} raw HTS entries", len(raw))

    flat_entries, chapters = load_or_process(raw, settings.hts_processed_path)
    logger.info("Flat entries: {:,} | Chapters: {}", len(flat_entries), len(chapters))

    vector_store = VectorStore()
    leaf_store = VectorStore(COLLECTION_LEAF)
    path_store = VectorStore(COLLECTION_PATH)
    logger.info(
        "ChromaDB loaded: avg={:,} leaf={:,} path={:,}",
        vector_store.count,
        leaf_store.count,
        path_store.count,
    )

    await embed_query("warmup")
    logger.info("Vertex AI client warmed up")

    app.state.vector_store = vector_store
    app.state.classifiers = {
        "embeddings": EmbeddingsClassifier(vector_store, leaf_store, path_store),
        "gar": GARClassifier(flat_entries),
        "agentic": AgenticClassifier(chapters),
        "rerank": RerankClassifier(vector_store),
    }

    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="HTS Classifier",
        description="AI-powered Harmonized Tariff Schedule classifier",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://localhost:4173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(classify.router)
    return app


app = create_app()
