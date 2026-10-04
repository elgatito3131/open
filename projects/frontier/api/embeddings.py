"""Real local MiniLM embeddings. Missing model files never trigger fake scores."""
from importlib.metadata import version
from threading import Lock

import numpy as np

from .config import CACHE, DIMENSIONS, MODEL

MODEL_KEY = f"{MODEL}@fastembed-{version('fastembed')}"
_model = None
_lock = Lock()


def model_cached() -> bool:
    return CACHE.exists() and any(CACHE.rglob("model.onnx"))


def load_model(allow_download: bool = False):
    global _model
    with _lock:
        if _model is None:
            # Catalog browsing should not import the whole ONNX/ML dependency
            # tree. Pay that cost only when semantic inference is requested.
            from fastembed import TextEmbedding

            _model = TextEmbedding(
                model_name=MODEL, cache_dir=str(CACHE), threads=2,
                local_files_only=not allow_download,
            )
    return _model


def embed_texts(texts: list[str], allow_download: bool = False) -> list[np.ndarray]:
    model = load_model(allow_download)
    vectors = [np.asarray(vector, dtype=np.float32) for vector in model.embed(texts)]
    if len(vectors) != len(texts) or any(
        vector.shape != (DIMENSIONS,) or not np.isfinite(vector).all()
        or np.linalg.norm(vector) == 0 for vector in vectors
    ):
        raise ValueError("Embedding model returned incompatible vectors.")
    return vectors


def metadata(available: bool) -> dict:
    return {"model": MODEL, "model_key": MODEL_KEY, "dimensions": DIMENSIONS,
            "available": available, "runtime": "FastEmbed / ONNX Runtime", "local": True}
