"""Server-only configuration; no database credentials enter API responses."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DIMENSIONS = 384
CACHE = ROOT / ".cache" / "embeddings"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL") or os.environ.get("FRONTIER_DATABASE_URL")
    if not url:
        raise RuntimeError("Set FRONTIER_DATABASE_URL before starting Frontier.")
    return url
