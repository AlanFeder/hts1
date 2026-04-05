from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    google_cloud_project: str
    google_cloud_location: str = "us-central1"

    embedding_model: str = "text-embedding-005"
    generation_model: str = "gemini-2.5-flash-lite"

    chroma_path: str = "data/chroma"
    hts_raw_path: str = "data/hts_raw.json"
    hts_processed_path: str = "data/hts_processed.json"

    embedding_concurrency: int = 8
    beam_width: int = 3
    default_top_k: int = 5


settings = Settings()  # ty: ignore[missing-argument]
