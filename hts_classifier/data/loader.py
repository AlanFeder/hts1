import json
from pathlib import Path

import httpx
from loguru import logger

HTS_URL = "https://www.usitc.gov/sites/default/files/tata/hts/hts_2026_revision_4_json.json"


def fetch_hts_data(cache_path: str = "data/hts_raw.json") -> list[dict]:
    """Fetch HTS JSON from USITC, caching locally after first download."""
    cache = Path(cache_path)
    if cache.exists():
        return json.loads(cache.read_text())

    logger.info(f"Downloading HTS data from {HTS_URL} ...")
    cache.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=120) as client:
        resp = client.get(HTS_URL)
        resp.raise_for_status()
        data = resp.json()

    cache.write_text(json.dumps(data))
    logger.info(f"Saved {len(data):,} raw entries to {cache}")
    return data
