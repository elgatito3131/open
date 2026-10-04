"""Repeatable fixture import and explicit offline embedding preparation."""
import argparse
import json

from pgvector.psycopg import register_vector

from . import database, embeddings


def prepare_embeddings() -> dict:
    """Only create vectors when the document or recorded model key changed."""
    with database.connect() as conn:
        labs = conn.execute("""
            SELECT l.* FROM frontier_labs l LEFT JOIN frontier_lab_embeddings e
              ON e.lab_id=l.id AND e.source_hash=l.source_hash AND e.model_key=%s
            WHERE e.lab_id IS NULL ORDER BY l.id
        """, (embeddings.MODEL_KEY,)).fetchall()
    if not labs:
        # Ensure the local inference files are ready even after a cache removal.
        embeddings.load_model(allow_download=True)
        return {"embedded": 0, "skipped": database.counts(embeddings.MODEL_KEY)[1]}
    vectors = embeddings.embed_texts([database.document_text(lab) for lab in labs], allow_download=True)
    with database.connect() as conn:
        register_vector(conn)
        for lab, vector in zip(labs, vectors):
            conn.execute("""
                INSERT INTO frontier_lab_embeddings (lab_id, model_key, source_hash, embedding)
                VALUES (%s,%s,%s,%s)
                ON CONFLICT (lab_id) DO UPDATE SET
                    model_key=EXCLUDED.model_key, source_hash=EXCLUDED.source_hash,
                    embedding=EXCLUDED.embedding, created_at=now()
            """, (lab["id"], embeddings.MODEL_KEY, lab["source_hash"], vector))
    return {"embedded": len(labs), "model": embeddings.MODEL_KEY, "dimensions": 384}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--embeddings", action="store_true")
    args = parser.parse_args()
    result = database.initialize()
    if args.embeddings:
        result.update(prepare_embeddings())
    print(json.dumps(result))


if __name__ == "__main__":
    main()
