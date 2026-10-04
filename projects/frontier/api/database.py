"""Parameterized PostgreSQL access; seeding never wipes existing records."""
import hashlib
import json
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from .config import ROOT, database_url

LAB_COLUMNS = "id, name, institution, discipline, location, summary, focus, topics, methods"


def connect():
    return psycopg.connect(database_url(), row_factory=dict_row, connect_timeout=5)


def document_text(lab: dict) -> str:
    return ". ".join([
        lab["name"], lab["discipline"], lab["summary"], lab["focus"],
        ", ".join(lab["topics"]), ", ".join(lab["methods"]),
    ])


def document_hash(lab: dict) -> str:
    return hashlib.sha256(document_text(lab).encode()).hexdigest()


def initialize() -> dict:
    """Create tables and upsert the owned fictional fixture transactionally."""
    labs = json.loads((ROOT / "data/labs.json").read_text())
    with connect() as conn:
        conn.execute((Path(__file__).with_name("schema.sql")).read_text())
        for lab in labs:
            conn.execute("""
                INSERT INTO frontier_labs
                    (id, name, institution, discipline, location, summary, focus,
                     topics, methods, source_hash)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO UPDATE SET
                    name=EXCLUDED.name, institution=EXCLUDED.institution,
                    discipline=EXCLUDED.discipline, location=EXCLUDED.location,
                    summary=EXCLUDED.summary, focus=EXCLUDED.focus,
                    topics=EXCLUDED.topics, methods=EXCLUDED.methods,
                    source_hash=EXCLUDED.source_hash, updated_at=now()
                WHERE (frontier_labs.source_hash, frontier_labs.institution,
                       frontier_labs.location) IS DISTINCT FROM
                      (EXCLUDED.source_hash, EXCLUDED.institution, EXCLUDED.location)
            """, tuple(lab[field] for field in LAB_COLUMNS.split(", ")) + (document_hash(lab),))
    return {"seeded": len(labs), "fictional": True}


def filtered_labs(discipline: str = "") -> list[dict]:
    with connect() as conn:
        return conn.execute(
            f"SELECT {LAB_COLUMNS} FROM frontier_labs "
            "WHERE (%s = '' OR discipline = %s) ORDER BY name, id",
            (discipline, discipline),
        ).fetchall()


def get_lab(lab_id: str) -> dict | None:
    with connect() as conn:
        return conn.execute(
            f"SELECT {LAB_COLUMNS} FROM frontier_labs WHERE id = %s", (lab_id,)
        ).fetchone()


def disciplines() -> list[str]:
    with connect() as conn:
        rows = conn.execute("SELECT DISTINCT discipline FROM frontier_labs ORDER BY discipline").fetchall()
        return [row["discipline"] for row in rows]


def counts(model_key: str) -> tuple[int, int]:
    with connect() as conn:
        labs = conn.execute("SELECT count(*) AS n FROM frontier_labs").fetchone()["n"]
        vectors = conn.execute("""
            SELECT count(*) AS n FROM frontier_lab_embeddings e
            JOIN frontier_labs l ON l.id=e.lab_id AND l.source_hash=e.source_hash
            WHERE e.model_key=%s
        """, (model_key,)).fetchone()["n"]
        return labs, vectors


def public_lab(lab: dict) -> dict:
    return {
        **lab,
        "provenance": {
            "kind": "fictional",
            "note": "Original demonstration record; not a real institution or lab.",
            "source": "data/labs.json",
        },
    }
