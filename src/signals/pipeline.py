from __future__ import annotations

from ..db.database import Database
from ..sentiment.ensemble import LABEL_RANK, combine_article_sentiment
from . import aggregation, detectors


def analyze_signals(ticker: str, db: Database = None) -> dict:
    """Pure computation over article_sentiment + articles -- no new storage
    (see architecture doc §7). Assumes sentiment analysis has already run for
    this ticker; does not trigger it."""
    db = db or Database()
    with db.connect() as conn:
        articles = conn.execute(
            "SELECT id, published_at FROM articles WHERE stage = 'B' AND query_context = ?", (ticker,)
        ).fetchall()
        sentiment_rows = conn.execute(
            "SELECT * FROM article_sentiment WHERE ticker = ?", (ticker,)
        ).fetchall()

    by_article: dict[int, list[dict]] = {}
    for r in sentiment_rows:
        by_article.setdefault(r["article_id"], []).append(dict(r))

    published_at_by_id = {a["id"]: a["published_at"] for a in articles}

    scored = []
    for article_id, rows in by_article.items():
        combined = combine_article_sentiment(rows)
        published_at = published_at_by_id.get(article_id)
        if not combined or not published_at:
            continue
        scored.append({
            "published_at": published_at,
            "rank": LABEL_RANK[combined["label"]],
            "confidence": combined["confidence"],
        })

    buckets = aggregation.bucket_articles(scored)
    windows = {name: aggregation.window_stats(arts) for name, arts in buckets.items()}
    signals = detectors.detect_all(windows)

    return {
        "ticker": ticker,
        "windows": windows,
        "signals": signals,
        "articles_scored": len(scored),
    }
