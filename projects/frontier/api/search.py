"""Observable keyword ranking and exact pgvector cosine retrieval."""
import re

from pgvector.psycopg import register_vector

from . import database, embeddings
from .source import trace_step


class SemanticUnavailable(Exception):
    pass


def query_terms(query: str) -> list[str]:
    """Unique lowercase words; punctuation does not become a search operator."""
    return list(dict.fromkeys(re.findall(r"[\w]+", query.casefold())))


def keyword_score(lab: dict, terms: list[str]) -> tuple[int, list[str]]:
    """A word in the name scores 3, topics 2, and descriptive text 1."""
    fields = [
        (set(query_terms(lab["name"])), 3),
        (set(query_terms(" ".join(lab["topics"]))), 2),
        (set(query_terms(" ".join([lab["summary"], lab["focus"], *lab["methods"]]))), 1),
    ]
    matched = [term for term in terms if any(term in words for words, _ in fields)]
    score = sum(weight for term in terms for words, weight in fields if term in words)
    return score, matched


def keyword_results(labs: list[dict], terms: list[str]) -> list[dict]:
    ranked = []
    for lab in labs:
        score, matched = keyword_score(lab, terms)
        if score > 0:
            ranked.append({**database.public_lab(lab), "score": score, "matched_terms": matched})
    return sorted(ranked, key=lambda row: (-row["score"], row["name"], row["id"]))


def semantic_results(query: str, discipline: str, limit: int) -> tuple[list[dict], int]:
    """Filters are applied inside SQL before nearest-neighbor ordering and limit."""
    labs_count, vector_count = database.counts(embeddings.MODEL_KEY)
    if not labs_count or vector_count != labs_count:
        raise SemanticUnavailable("Semantic search needs current lab embeddings. Run python -m api.seed --embeddings.")
    try:
        vector = embeddings.embed_texts([query])[0]
    except Exception as error:
        raise SemanticUnavailable("The local embedding model is unavailable. Prepare it with python -m api.seed --embeddings.") from error
    with database.connect() as conn:
        register_vector(conn)
        rows = conn.execute("""
            SELECT l.id, l.name, l.institution, l.discipline, l.location,
                   l.summary, l.focus, l.topics, l.methods,
                   1 - (e.embedding <=> %s) AS score, count(*) OVER () AS total
            FROM frontier_labs l JOIN frontier_lab_embeddings e
              ON e.lab_id=l.id AND e.source_hash=l.source_hash
            WHERE e.model_key=%s AND (%s='' OR l.discipline=%s)
            ORDER BY e.embedding <=> %s, l.name, l.id LIMIT %s
        """, (vector, embeddings.MODEL_KEY, discipline, discipline, vector, limit)).fetchall()
    total = rows[0]["total"] if rows else 0
    results = []
    for row in rows:
        row.pop("total")
        row["score"] = round(float(row["score"]), 6)
        row["matched_terms"] = keyword_score(row, query_terms(query))[1]
        results.append(database.public_lab(row))
    return results, total


def search(query: str, mode: str, discipline: str, limit: int) -> dict:
    query = query.strip()
    trace = [trace_step(1, "Receive the search",
             f"Query: {query or '(browse all)'}. Mode: {mode}. Discipline: {discipline or 'all'}. Limit: {limit}.", search)]
    labs_count, vector_count = database.counts(embeddings.MODEL_KEY)
    ready = labs_count > 0 and labs_count == vector_count and embeddings.model_cached()

    if not query:
        labs = database.filtered_labs(discipline)
        results = [{**database.public_lab(lab), "score": 0, "matched_terms": []} for lab in labs[:limit]]
        total = len(labs)
        trace.append(trace_step(2, "Browse the catalog", f"PostgreSQL selected {total} records using the discipline filter. Blank queries use alphabetical order, not similarity.", database.filtered_labs))
    elif mode == "keyword":
        terms = query_terms(query)
        trace.append(trace_step(2, "Prepare query words", f"Unique lowercase words: {', '.join(terms) or '(none)'}. No synonym expansion is applied.", query_terms))
        labs = database.filtered_labs(discipline)
        trace.append(trace_step(3, "Filter in PostgreSQL", f"The parameterized discipline query returned {len(labs)} candidate labs.", database.filtered_labs))
        ranked = keyword_results(labs, terms)
        total = len(ranked)
        results = ranked[:limit]
        trace.append(trace_step(4, "Score exact word matches", f"Name matches add 3 points, topic matches add 2, descriptive text adds 1. {total} labs have at least one matching word.", keyword_score))
        trace.append(trace_step(5, "Order the matches", f"Higher scores first; ties use lab name, then ID. Return up to {limit} records.", keyword_results))
    else:
        results, total = semantic_results(query, discipline, limit)
        trace.append(trace_step(2, "Encode the question", f"The local {embeddings.MODEL} model converted the query into 384 floating-point values using FastEmbed.", embeddings.embed_texts))
        trace.append(trace_step(3, "Compare in pgvector", f"PostgreSQL filtered {total} compatible stored vectors, then ordered them by cosine distance. Displayed score = 1 − distance; it is not a probability.", semantic_results))
        trace.append(trace_step(4, "Return nearest records", f"Return {len(results)} neighbors. Semantic retrieval always returns the nearest available records, even when a query is outside this small catalog.", semantic_results))
    trace.append(trace_step(len(trace) + 1, "Show the evidence", f"Returned {len(results)} of {total} records. Profiles are fictional, and source points to the original fixture.", database.public_lab))
    return {"query": query, "mode": mode, "discipline": discipline, "total": total,
            "results": results, "trace": trace, "embedding": embeddings.metadata(ready)}
