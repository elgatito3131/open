"""HTTP boundary: validate input, delegate retrieval, return useful failures."""
from contextlib import asynccontextmanager
from typing import Literal

import psycopg
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from . import database, embeddings
from .search import SemanticUnavailable, search
from .source import source_file


@asynccontextmanager
async def lifespan(app):
    database.initialize()
    yield


app = FastAPI(title="Frontier — fictional research discovery", version="1.0.0", lifespan=lifespan)


@app.exception_handler(psycopg.Error)
async def database_error(request, error):
    return JSONResponse(status_code=503, content={"detail": "The local PostgreSQL database is unavailable. Check its process and database configuration."})


@app.get("/api/health")
def health():
    count, vector_count = database.counts(embeddings.MODEL_KEY)
    ready = count > 0 and vector_count == count and embeddings.model_cached()
    return {"status": "ok", "database": "PostgreSQL + pgvector",
            "dataset": {"count": count, "fictional": True},
            "semantic": {**embeddings.metadata(ready), "indexed": vector_count}}


@app.get("/api/disciplines")
def disciplines():
    return {"disciplines": database.disciplines()}


@app.get("/api/labs")
def labs(q: str = Query("", max_length=500), mode: Literal["keyword", "semantic"] = "keyword",
         discipline: str = Query("", max_length=100), limit: int = Query(12, ge=1, le=50)):
    try:
        return search(q, mode, discipline.strip(), limit)
    except SemanticUnavailable as error:
        raise HTTPException(503, str(error)) from error


@app.get("/api/labs/{lab_id}")
def lab(lab_id: str):
    result = database.get_lab(lab_id)
    if result is None:
        raise HTTPException(404, "Lab not found.")
    return database.public_lab(result)


@app.get("/api/source")
def source(file: str = Query("api/search.py", max_length=100)):
    try:
        return source_file(file)
    except KeyError as error:
        raise HTTPException(404, "This file is not in the public source allowlist.") from error
