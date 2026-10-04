"""HTTP integration checks in an isolated disposable PostgreSQL schema."""
import json
import os
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.conninfo import make_conninfo

from . import database, embeddings
from .config import ROOT, database_url
from .main import app
from .seed import prepare_embeddings


@pytest.fixture(scope="module")
def client():
    original_url = database_url()
    original_override = os.environ.get("DATABASE_URL")
    schema = "frontier_test_" + uuid4().hex[:12]
    with psycopg.connect(original_url) as conn:
        conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    os.environ["DATABASE_URL"] = make_conninfo(original_url, options=f"-csearch_path={schema},public")
    try:
        with TestClient(app) as test_client:
            prepare_embeddings()
            yield test_client
    finally:
        if original_override is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = original_override
        with psycopg.connect(original_url) as conn:
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def test_browse_and_profile(client):
    result = client.get("/api/labs").json()
    assert result["total"] == 12
    names = [lab["name"] for lab in result["results"]]
    assert names == sorted(names)
    assert all(lab["score"] == 0 and lab["provenance"]["kind"] == "fictional" for lab in result["results"])
    lab_id = result["results"][0]["id"]
    assert client.get(f"/api/labs/{lab_id}").json()["id"] == lab_id
    assert client.get("/api/labs/unknown-lab").status_code == 404


def test_disciplines_and_filters(client):
    disciplines = client.get("/api/disciplines").json()["disciplines"]
    assert len(disciplines) == 6
    result = client.get("/api/labs", params={"discipline": disciplines[0]}).json()
    assert result["total"] == 2
    assert all(lab["discipline"] == disciplines[0] for lab in result["results"])
    assert client.get("/api/labs", params={"discipline": "Unknown"}).json()["results"] == []


def test_keyword_ranking_normalization_and_no_match(client):
    first = client.get("/api/labs", params={"q": "HEAT, heat!!"}).json()
    second = client.get("/api/labs", params={"q": "heat"}).json()
    assert first["results"] == second["results"]
    assert first["results"][0]["id"] == "urban-climate"
    assert first["results"][0]["matched_terms"] == ["heat"]
    assert client.get("/api/labs", params={"q": "zxqvnonexistent"}).json()["total"] == 0
    assert client.get("/api/labs", params={"q": "!!!"}).json()["results"] == []
    assert client.get("/api/labs", params={"q": "heat", "discipline": "Culture & Design"}).json()["results"] == []


@pytest.mark.parametrize("params", [
    {"q": "x" * 501}, {"limit": 0}, {"limit": 51}, {"limit": "many"},
    {"mode": "imaginary"}, {"discipline": "x" * 101},
])
def test_input_validation(client, params):
    assert client.get("/api/labs", params=params).status_code == 422


@pytest.mark.parametrize("file", ["../../.env", "/etc/passwd", "api/config.py", ".env", "data/../api/config.py"])
def test_source_allowlist(client, file):
    assert client.get("/api/source", params={"file": file}).status_code == 404


def test_trace_matches_actual_source(client):
    result = client.get("/api/labs", params={"q": "heat"}).json()
    for step in result["trace"]:
        source = client.get("/api/source", params={"file": step["file"]}).json()["source"]
        actual = source.splitlines(keepends=True)[step["lineStart"] - 1:step["lineEnd"]]
        assert "".join(actual) == step["snippet"]


def test_seeding_is_idempotent_and_non_destructive(client):
    with database.connect() as conn:
        conn.execute("""
            INSERT INTO frontier_labs (id,name,institution,discipline,location,summary,focus,topics,methods,source_hash)
            VALUES ('extra-test','Extra fixture','Test','Test','Test','Test','Test','{}','{}','test')
        """)
    try:
        database.initialize()
        database.initialize()
        assert database.get_lab("extra-test") is not None
        assert len(database.filtered_labs()) == 13
    finally:
        with database.connect() as conn:
            conn.execute("DELETE FROM frontier_labs WHERE id='extra-test'")


@pytest.mark.parametrize("case", json.loads((ROOT / "data/evaluation.json").read_text()))
def test_fixed_semantic_queries(client, case):
    response = client.get("/api/labs", params={"q": case["query"], "mode": "semantic", "limit": 3})
    assert response.status_code == 200, response.text
    result = response.json()
    assert case["expected_in_top_3"] in [lab["id"] for lab in result["results"]]
    assert all(-1 <= lab["score"] <= 1 for lab in result["results"])
    scores = [lab["score"] for lab in result["results"]]
    assert scores == sorted(scores, reverse=True)
    assert result["embedding"]["dimensions"] == 384


def test_semantic_filters_and_limit_before_ranking(client):
    response = client.get("/api/labs", params={"q": "climate heat", "mode": "semantic", "discipline": "Culture & Design", "limit": 1})
    assert response.status_code == 200
    result = response.json()
    assert result["total"] == 2 and len(result["results"]) == 1
    assert result["results"][0]["discipline"] == "Culture & Design"


def test_health_and_missing_semantic_state(client, monkeypatch):
    health = client.get("/api/health").json()
    assert health["dataset"] == {"count": 12, "fictional": True}
    assert health["semantic"]["available"] is True
    monkeypatch.setattr(database, "counts", lambda key: (12, 11))
    assert client.get("/api/labs", params={"q": "heat", "mode": "semantic"}).status_code == 503
    assert client.get("/api/labs", params={"q": "heat", "mode": "keyword"}).status_code == 200


def test_model_failure_is_not_silent_keyword_fallback(client, monkeypatch):
    def unavailable(*args, **kwargs):
        raise RuntimeError("Model files unavailable")
    monkeypatch.setattr(embeddings, "embed_texts", unavailable)
    response = client.get("/api/labs", params={"q": "heat", "mode": "semantic"})
    assert response.status_code == 503
    assert "model is unavailable" in response.json()["detail"]


def test_database_failure_does_not_leak_configuration(client, monkeypatch):
    def unavailable():
        raise psycopg.OperationalError("private connection credentials")
    monkeypatch.setattr(database, "connect", unavailable)
    response = client.get("/api/health")
    assert response.status_code == 503
    assert "credentials" not in response.text
