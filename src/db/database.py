from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_PATH = Path(__file__).parent / "schema.sql"
# Overridable via DB_PATH so a deployment can point this at a mounted
# persistent volume (e.g. Railway) instead of a path inside the container's
# ephemeral filesystem, which gets wiped on every redeploy. Unset locally,
# so local dev is unaffected.
DEFAULT_DB_PATH = Path(os.environ.get("DB_PATH") or Path(__file__).parent.parent.parent / "data" / "sentiment_investment.db")


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def normalize_url(url: str) -> str:
    return url.strip().rstrip("/").lower()


def url_hash(url: str) -> str:
    return hashlib.sha256(normalize_url(url).encode("utf-8")).hexdigest()


class Database:
    def __init__(self, db_path: Path | str = DEFAULT_DB_PATH):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        # init_schema() is entirely CREATE TABLE IF NOT EXISTS + guarded
        # column migrations (see below), so it's safe and cheap to run every
        # time rather than requiring a separate manual `scripts/init_db.py`
        # step -- which a fresh deployment (empty volume, brand new db file)
        # would otherwise silently need before any route touching the DB
        # works at all.
        self.init_schema()

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # Columns added after a table's initial schema; kept as additive migrations
    # so an already-populated table doesn't need to be dropped/recreated.
    _MIGRATIONS = [
        ("articles", "full_text", "ALTER TABLE articles ADD COLUMN full_text TEXT"),
        ("articles", "full_text_status", "ALTER TABLE articles ADD COLUMN full_text_status TEXT"),
        ("articles", "full_text_extracted_at", "ALTER TABLE articles ADD COLUMN full_text_extracted_at TEXT"),
        ("article_entities", "relevance", "ALTER TABLE article_entities ADD COLUMN relevance TEXT"),
        ("article_entities", "relevance_reason", "ALTER TABLE article_entities ADD COLUMN relevance_reason TEXT"),
        ("article_sentiment", "relevance", "ALTER TABLE article_sentiment ADD COLUMN relevance TEXT"),
        ("article_sentiment", "relevance_reason", "ALTER TABLE article_sentiment ADD COLUMN relevance_reason TEXT"),
    ]

    def init_schema(self):
        with self.connect() as conn:
            conn.executescript(SCHEMA_PATH.read_text())
            for table, col_name, ddl in self._MIGRATIONS:
                existing_cols = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
                if col_name not in existing_cols:
                    conn.execute(ddl)

    def insert_article(self, conn, article: dict) -> tuple[bool, int]:
        """Insert one normalized article dict. Returns (is_new, article_id) --
        is_new is False when this url_hash already existed (dedup hit), but the
        row's id is returned either way so callers can act on it (e.g. backfill
        full_text) regardless of whether this particular call inserted it."""
        h = url_hash(article["url"])
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO articles (
                source, stage, query_context, source_article_id, url, url_hash,
                title, summary, author, published_at,
                provider_sentiment_label, provider_sentiment_score, raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                article["source"],
                article["stage"],
                article["query_context"],
                article.get("source_article_id"),
                article["url"],
                h,
                article["title"],
                article.get("summary"),
                article.get("author"),
                article.get("published_at"),
                article.get("provider_sentiment_label"),
                article.get("provider_sentiment_score"),
                json.dumps(article.get("raw_payload"), default=str) if article.get("raw_payload") is not None else None,
            ),
        )
        is_new = cur.rowcount > 0
        row = conn.execute("SELECT id FROM articles WHERE url_hash = ?", (h,)).fetchone()
        return is_new, row["id"]

    def get_missing_full_text_ids(self, conn, article_ids: list) -> set:
        """Of the given article ids, which ones don't have full_text scraped yet."""
        if not article_ids:
            return set()
        placeholders = ",".join("?" for _ in article_ids)
        rows = conn.execute(
            f"SELECT id FROM articles WHERE id IN ({placeholders}) AND full_text IS NULL",
            article_ids,
        )
        return {row["id"] for row in rows}

    def set_full_text(self, conn, article_id: int, full_text, status: str):
        conn.execute(
            "UPDATE articles SET full_text = ?, full_text_status = ?, full_text_extracted_at = ? WHERE id = ?",
            (full_text, status, utcnow_iso(), article_id),
        )

    def get_articles_missing_entities(self, conn, article_ids: list) -> set:
        """Of the given article ids, which ones have never had NER attempted --
        tracked via article_entity_runs (not article_entities itself, which
        only stores positive detections and can't distinguish "not yet
        processed" from "processed, found nothing")."""
        if not article_ids:
            return set()
        placeholders = ",".join("?" for _ in article_ids)
        rows = conn.execute(
            f"SELECT article_id FROM article_entity_runs WHERE article_id IN ({placeholders})",
            article_ids,
        )
        already_done = {row["article_id"] for row in rows}
        return set(article_ids) - already_done

    def mark_entity_extraction_done(self, conn, article_id: int):
        conn.execute(
            "INSERT OR IGNORE INTO article_entity_runs (article_id) VALUES (?)",
            (article_id,),
        )

    def insert_entity(self, conn, *, article_id, ticker, company_name, method, confidence,
                       evidence_text=None, relevance=None, relevance_reason=None):
        conn.execute(
            """
            INSERT INTO article_entities (
                article_id, ticker, company_name, method, confidence,
                evidence_text, relevance, relevance_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (article_id, ticker, company_name, method, confidence, evidence_text, relevance, relevance_reason),
        )

    def get_articles_missing_sentiment(self, conn, article_ids: list) -> set:
        """Same idempotency pattern as get_articles_missing_entities, tracked
        via article_sentiment_runs."""
        if not article_ids:
            return set()
        placeholders = ",".join("?" for _ in article_ids)
        rows = conn.execute(
            f"SELECT article_id FROM article_sentiment_runs WHERE article_id IN ({placeholders})",
            article_ids,
        )
        already_done = {row["article_id"] for row in rows}
        return set(article_ids) - already_done

    def mark_sentiment_done(self, conn, article_id: int):
        conn.execute(
            "INSERT OR IGNORE INTO article_sentiment_runs (article_id) VALUES (?)",
            (article_id,),
        )

    def insert_sentiment(self, conn, *, article_id, ticker, method, label, confidence,
                          score=None, evidence_text=None, reasoning=None,
                          relevance=None, relevance_reason=None):
        conn.execute(
            """
            INSERT INTO article_sentiment (
                article_id, ticker, method, label, score, confidence, evidence_text,
                reasoning, relevance, relevance_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (article_id, ticker, method, label, score, confidence, evidence_text,
             reasoning, relevance, relevance_reason),
        )

    def log_ingestion_run(self, conn, *, source, stage, query, started_at, finished_at,
                           status, articles_fetched, articles_new, error_message=None):
        conn.execute(
            """
            INSERT INTO ingestion_runs (
                source, stage, query, started_at, finished_at, status,
                articles_fetched, articles_new, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (source, stage, query, started_at, finished_at, status,
             articles_fetched, articles_new, error_message),
        )
