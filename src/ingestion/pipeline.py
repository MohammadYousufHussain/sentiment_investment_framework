from __future__ import annotations

import logging
import time

from ..db.database import Database, utcnow_iso
from .alpha_vantage_client import AlphaVantageSource
from .benzinga_client import BenzingaSource
from .full_text import extract_full_text_batch
from .google_news_rss import GoogleNewsRSSSource
from .newsapi_client import NewsAPISource
from .yahoo_search_client import YahooSearchSource
from .yahoo_ticker_news_client import YahooTickerNewsSource

logger = logging.getLogger(__name__)

STAGE_A_SOURCES = [
    GoogleNewsRSSSource(),
    NewsAPISource(),
    AlphaVantageSource(),
    YahooSearchSource(),
]


def _ingest_articles(db: Database, conn, *, source_name: str, stage: str, query_context: str,
                      articles: list, fetch_full_text: bool, started_at: str) -> dict:
    """Shared insert/full-text-scrape/logging logic -- identical for Stage A
    and Stage B, only how `articles` was fetched differs between them."""
    tagged_articles = []
    new_count = 0
    for a in articles:
        is_new, article_id = db.insert_article(conn, a.as_dict())
        new_count += int(is_new)
        tagged_articles.append({**a.as_dict(), "is_new": is_new, "id": article_id})
    conn.commit()

    if fetch_full_text and tagged_articles:
        ids = [a["id"] for a in tagged_articles]
        missing_ids = db.get_missing_full_text_ids(conn, ids)
        if missing_ids:
            batch = [(a["id"], a["source"], a["url"]) for a in tagged_articles if a["id"] in missing_ids]
            scraped = extract_full_text_batch(batch)
            for article_id, (full_text, status) in scraped.items():
                db.set_full_text(conn, article_id, full_text, status)
            conn.commit()
            for a in tagged_articles:
                if a["id"] in scraped:
                    full_text, status = scraped[a["id"]]
                    a["full_text"] = full_text
                    a["full_text_status"] = status

    db.log_ingestion_run(
        conn,
        source=source_name, stage=stage, query=query_context,
        started_at=started_at, finished_at=utcnow_iso(),
        status="success", articles_fetched=len(articles), articles_new=new_count,
    )
    conn.commit()
    logger.info("[%s] fetched=%d new=%d", source_name, len(articles), new_count)
    return {
        "source": source_name, "status": "success",
        "fetched": len(articles), "new": new_count,
        "articles": tagged_articles,
    }


def run_stage_a_iter(query: str, db: Database = None, sources: list = None,
                      max_results: int = 20, fetch_full_text: bool = True):
    """Generator core of Stage A: fetches + stores one source at a time, yielding
    a per-source result (including the articles themselves, each tagged with
    whether it was newly inserted or a dedup hit, plus scraped full_text where
    available) as soon as that source completes. Used by both the CLI (which
    drains it into a summary dict) and the web app (which streams each yielded
    result to the browser as it happens).

    Full-text scraping is idempotent/backfilling: it's attempted for any article
    missing full_text, whether it was newly inserted by this run or already
    existed from a previous one -- so re-running an old query progressively
    fills gaps rather than only covering brand-new articles."""
    db = db or Database()
    sources = sources if sources is not None else STAGE_A_SOURCES

    with db.connect() as conn:
        for i, source in enumerate(sources):
            started_at = utcnow_iso()
            try:
                articles = source.fetch(query, max_results=max_results)
                yield _ingest_articles(
                    db, conn, source_name=source.name, stage="A", query_context=query,
                    articles=articles, fetch_full_text=fetch_full_text, started_at=started_at,
                )
            except Exception as exc:
                db.log_ingestion_run(
                    conn,
                    source=source.name, stage="A", query=query,
                    started_at=started_at, finished_at=utcnow_iso(),
                    status="error", articles_fetched=0, articles_new=0, error_message=str(exc),
                )
                conn.commit()
                logger.error("[%s] failed: %s", source.name, exc)
                yield {
                    "source": source.name, "status": "error",
                    "fetched": 0, "new": 0, "articles": [], "error": str(exc),
                }

            if i < len(sources) - 1:
                time.sleep(source.min_delay_seconds)


def run_stage_a(query: str, db: Database = None, sources: list = None,
                 max_results: int = 20, fetch_full_text: bool = True) -> dict:
    """Fetch news for a user-supplied keyword/topic across all Stage A sources,
    store results, and return a summary of what happened per source."""
    summary = {}
    for result in run_stage_a_iter(query, db=db, sources=sources, max_results=max_results,
                                    fetch_full_text=fetch_full_text):
        source = result.pop("source")
        result.pop("articles", None)
        summary[source] = result
    return summary


def _build_stage_b_sources():
    """Stage B reuses all four Stage A source clients (Google News RSS and
    NewsAPI queried by company name -- their HTTP call is identical either
    way; Alpha Vantage and Yahoo switched to their native ticker-scoped modes,
    which is a genuinely different API call, not just a different query
    string), plus Benzinga (ticker-scoped only, see benzinga_client.py).

    Returns a list of (name, min_delay_seconds, fetch_fn) where fetch_fn(ticker,
    company_name, max_results) -> list[Article], so the orchestrator loop can
    stay identical to Stage A's despite each source needing a different
    identifier (ticker vs. company name)."""
    google_rss = GoogleNewsRSSSource()
    newsapi = NewsAPISource()
    alpha_vantage = AlphaVantageSource()
    benzinga = BenzingaSource()
    yahoo_ticker = YahooTickerNewsSource()

    return [
        (google_rss.name, google_rss.min_delay_seconds,
         lambda ticker, company_name, max_results: google_rss.fetch(company_name, max_results=max_results, stage="B")),
        (newsapi.name, newsapi.min_delay_seconds,
         lambda ticker, company_name, max_results: newsapi.fetch(company_name, max_results=max_results, stage="B")),
        (alpha_vantage.name, alpha_vantage.min_delay_seconds,
         lambda ticker, company_name, max_results: alpha_vantage.fetch_by_ticker(ticker, max_results=max_results)),
        (benzinga.name, benzinga.min_delay_seconds,
         lambda ticker, company_name, max_results: benzinga.fetch(ticker, max_results=max_results)),
        (yahoo_ticker.name, yahoo_ticker.min_delay_seconds,
         lambda ticker, company_name, max_results: yahoo_ticker.fetch(ticker, max_results=max_results)),
    ]


def run_stage_b_iter(ticker: str, company_name: str, db: Database = None, sources: list = None,
                      max_results: int = 20, fetch_full_text: bool = True):
    """Generator core of Stage B: ticker-scoped deep ingestion for one company
    the user selected from the Stage A/NER candidate list. Mirrors
    run_stage_a_iter's shape (same per-source yield contract, same dedup/
    full-text/logging behavior via _ingest_articles) so it can be streamed to
    the web app the same way."""
    db = db or Database()
    sources = sources if sources is not None else _build_stage_b_sources()

    with db.connect() as conn:
        for i, (source_name, min_delay, fetch_fn) in enumerate(sources):
            started_at = utcnow_iso()
            try:
                articles = fetch_fn(ticker, company_name, max_results)
                # Google RSS/NewsAPI set query_context to whatever string was
                # passed to fetch() -- company_name here, not ticker. Force it
                # so every Stage B article is queryable by ticker regardless
                # of which source produced it.
                for a in articles:
                    a.query_context = ticker
                yield _ingest_articles(
                    db, conn, source_name=source_name, stage="B", query_context=ticker,
                    articles=articles, fetch_full_text=fetch_full_text, started_at=started_at,
                )
            except Exception as exc:
                db.log_ingestion_run(
                    conn,
                    source=source_name, stage="B", query=ticker,
                    started_at=started_at, finished_at=utcnow_iso(),
                    status="error", articles_fetched=0, articles_new=0, error_message=str(exc),
                )
                conn.commit()
                logger.error("[%s] failed: %s", source_name, exc)
                yield {
                    "source": source_name, "status": "error",
                    "fetched": 0, "new": 0, "articles": [], "error": str(exc),
                }

            if i < len(sources) - 1:
                time.sleep(min_delay)


def run_stage_b(ticker: str, company_name: str, db: Database = None, sources: list = None,
                 max_results: int = 20, fetch_full_text: bool = True) -> dict:
    """Ticker-scoped deep ingestion across all 5 Stage B sources, store
    results, and return a summary of what happened per source."""
    summary = {}
    for result in run_stage_b_iter(ticker, company_name, db=db, sources=sources,
                                    max_results=max_results, fetch_full_text=fetch_full_text):
        source = result.pop("source")
        result.pop("articles", None)
        summary[source] = result
    return summary
