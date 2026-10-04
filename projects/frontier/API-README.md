# Frontier backend

An original research-discovery demonstration using 12 fictional labs. Institution names, profiles, and research descriptions are synthetic. This is a new portfolio reconstruction, not recovered historical Frontier software or evidence of adoption by a real university.

## Run

Use the root setup/start scripts for the complete application. The API itself runs from this folder:

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.lock
# Export FRONTIER_DATABASE_URL or DATABASE_URL for a PostgreSQL database with pgvector.
.venv/bin/python -m api.seed --embeddings
.venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 4203
```

The explicit seed command downloads the public embedding model on its first run. Later searches use the local cache under `.cache/embeddings/`. Python owns SQL and ranking; Next.js forwards browser API requests to Python. A missing database is an error, and unavailable semantic retrieval returns HTTP 503 without silently substituting keyword scores.

## Search and storage

- Blank query: browse filtered records in alphabetical order.
- Keyword: unique, case-folded words match whole tokens. A match in the lab name adds 3 points, topics 2, descriptive text 1. Ties sort by name and ID. No stemming or synonym expansion is performed.
- Semantic: FastEmbed runs the real `sentence-transformers/all-MiniLM-L6-v2` model locally. PostgreSQL pgvector computes exact cosine distance across 384-dimensional stored vectors. Discipline filtering happens before ordering and limiting. The displayed similarity is `1 − cosine distance`, not confidence or a probability. The nearest records can still be irrelevant.
- The small catalog uses exact vector scans; approximate indexes are intentionally unnecessary for 12 records.
- Embeddings are linked to a document hash and model/library key. Changed documents cannot silently use stale vectors. Run the seed command to refresh them.
- Seeding upserts the owned fixture IDs transactionally and preserves other records. Repeating it neither duplicates records nor wipes the database.
- Local PostgreSQL is the tested path. The schema is compatible with a PostgreSQL database supporting pgvector, including Supabase. No Supabase cloud project, authentication, access-control policy, or deployment has been configured or tested.

## HTTP contract

`GET /api/labs?q=&mode=keyword|semantic&discipline=&limit=12` returns results, total matched candidates, query context, embedding metadata, and executed trace steps. Each step points to a real function's current source range. Traces explain computation; they are not simulated database records or generated reasoning.

`GET /api/labs/{id}` returns a profile. `GET /api/disciplines` provides filter choices. `GET /api/health` reports database availability and indexed-vector count. `GET /api/source?file=api/search.py` exposes only a small fixed allowlist of public source files; it cannot read runtime credentials or arbitrary paths.

## Checks

```sh
./test.sh
```

Checks use a disposable PostgreSQL schema and remove it afterward. They cover endpoint validation, filtering, ranking, profile lookup, seed repeatability, source-path rejection, real trace ranges, unavailable dependencies, and six fixed semantic-retrieval examples in `data/evaluation.json`. These are small demonstration acceptance examples, not a benchmark of general research-search quality.

## Stack and model sources

Python 3.12; FastAPI 0.142.2; psycopg 3.3.6; pgvector Python client 0.5.0; FastEmbed 0.8.1; ONNX Runtime 1.30.0. Full installed dependency pins are in `requirements.lock`.

The model is listed in [FastEmbed's supported models](https://qdrant.github.io/fastembed/examples/Supported_Models/) with 384 dimensions and an Apache-2.0 license. [pgvector's Python integration](https://github.com/pgvector/pgvector-python) documents the PostgreSQL driver integration. Model files remain in the ignored local cache, outside repository source.

## Boundaries

This is a local, read-only discovery demo. It has no user accounts, contact workflow, generated answers, scraper, private documents, or production authorization. No private coursework, résumé text, interviews, or historical business data were copied into it. A learner can next add one synthetic lab, refresh its embedding, and explain how keyword and semantic ordering differ.
