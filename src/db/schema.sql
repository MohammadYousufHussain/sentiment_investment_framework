-- Stage A news ingestion schema, plus the NER schema (see
-- architecture/name_entity_recognition.md). article_entities is additive --
-- CREATE TABLE IF NOT EXISTS needs no migration machinery, unlike the
-- full_text columns above which were added to an already-populated table.

CREATE TABLE IF NOT EXISTS articles (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    source                   TEXT NOT NULL,
    stage                    TEXT NOT NULL CHECK (stage IN ('A', 'B')),
    query_context            TEXT NOT NULL,
    source_article_id        TEXT,
    url                      TEXT NOT NULL,
    url_hash                 TEXT NOT NULL UNIQUE,
    title                    TEXT NOT NULL,
    summary                  TEXT,
    author                   TEXT,
    published_at             TEXT,
    ingested_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    provider_sentiment_label TEXT,
    provider_sentiment_score REAL,
    raw_payload              TEXT,
    full_text                TEXT,
    full_text_status         TEXT,
    full_text_extracted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);
CREATE INDEX IF NOT EXISTS idx_articles_stage ON articles(stage);
CREATE INDEX IF NOT EXISTS idx_articles_query_context ON articles(query_context);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    source           TEXT NOT NULL,
    stage            TEXT NOT NULL CHECK (stage IN ('A', 'B')),
    query            TEXT NOT NULL,
    started_at       TEXT NOT NULL,
    finished_at      TEXT,
    status           TEXT NOT NULL CHECK (status IN ('success', 'error')),
    articles_fetched INTEGER,
    articles_new     INTEGER,
    error_message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source ON ingestion_runs(source);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_query ON ingestion_runs(query);

-- Raw Layer-1 detections only, one row per (article, ticker, method).
-- Layer 2 (noisy-OR combination) and Layer 3 (per-search rollup) are computed
-- on read via SQL aggregation, not stored, so they always stay consistent
-- with the underlying detections.
CREATE TABLE IF NOT EXISTS article_entities (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id    INTEGER NOT NULL REFERENCES articles(id),
    ticker        TEXT NOT NULL,
    company_name  TEXT NOT NULL,
    method        TEXT NOT NULL CHECK (method IN ('spacy_fuzzy', 'llm')),
    confidence    REAL NOT NULL,
    evidence_text TEXT,
    relevance        TEXT,  -- 'High'/'Medium'/'Low' -- only populated for method='llm' (see §"Relevance" in the doc); NULL for spacy_fuzzy rows and for LLM calls made before this was added
    relevance_reason TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_article_entities_article ON article_entities(article_id);
CREATE INDEX IF NOT EXISTS idx_article_entities_ticker ON article_entities(ticker);

-- Marks that NER was attempted on an article, independent of whether any
-- entity was found. article_entities alone can't distinguish "not yet
-- processed" from "processed, found nothing" -- without this, articles that
-- legitimately mention no company get expensively re-processed (including
-- LLM calls) on every re-run.
CREATE TABLE IF NOT EXISTS article_entity_runs (
    article_id   INTEGER PRIMARY KEY REFERENCES articles(id),
    processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Ticker-specific sentiment (see architecture/sentiment_analysis.md). Raw
-- per-method detections only, one row per (article, ticker, method) --
-- agreement between methods is computed on read, not stored (see doc §4).
CREATE TABLE IF NOT EXISTS article_sentiment (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id    INTEGER NOT NULL REFERENCES articles(id),
    ticker        TEXT NOT NULL,
    method        TEXT NOT NULL CHECK (method IN ('finbert', 'llm')),
    label         TEXT NOT NULL CHECK (label IN ('Bullish', 'Somewhat-Bullish', 'Neutral', 'Somewhat-Bearish', 'Bearish')),
    score         REAL,     -- FinBERT's continuous p_positive - p_negative before bucketing; NULL for llm rows
    confidence    REAL NOT NULL,
    evidence_text TEXT,     -- FinBERT: extracted snippet(s); LLM: supporting quote
    reasoning     TEXT,     -- LLM only
    relevance        TEXT,  -- 'Primary'/'Secondary'/'Incidental' -- LLM only; is this ticker the article's actual subject, or an incidental reference (see architecture doc)
    relevance_reason TEXT,  -- LLM only
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_article_sentiment_article ON article_sentiment(article_id);
CREATE INDEX IF NOT EXISTS idx_article_sentiment_ticker ON article_sentiment(ticker);

-- Web app accounts (email/password, no billing). COLLATE NOCASE on email so
-- signup/login can't create case-variant duplicates of the same address.
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Same idempotency fix as article_entity_runs -- marks that scoring was
-- attempted regardless of whether it succeeded, so a genuinely unscoreable
-- article isn't re-processed (including LLM calls) on every re-run.
CREATE TABLE IF NOT EXISTS article_sentiment_runs (
    article_id   INTEGER PRIMARY KEY REFERENCES articles(id),
    processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
