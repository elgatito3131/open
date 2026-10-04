CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS frontier_labs (
    id text PRIMARY KEY,
    name text NOT NULL,
    institution text NOT NULL,
    discipline text NOT NULL,
    location text NOT NULL,
    summary text NOT NULL,
    focus text NOT NULL,
    topics text[] NOT NULL,
    methods text[] NOT NULL,
    source_hash text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS frontier_lab_embeddings (
    lab_id text PRIMARY KEY REFERENCES frontier_labs(id) ON DELETE CASCADE,
    model_key text NOT NULL,
    source_hash text NOT NULL,
    embedding vector(384) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS frontier_labs_discipline ON frontier_labs(discipline);
