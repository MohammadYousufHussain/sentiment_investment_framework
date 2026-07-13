from __future__ import annotations

from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

from .. import config
from .base import Article, NewsSource
from .http_utils import get_with_retry

BASE_URL = "https://api.benzinga.com/api/v2/news"
DEFAULT_LOOKBACK_DAYS = 30


def _benzinga_date_to_iso(raw: str):
    # Benzinga format: "Sat, 11 Jul 2026 04:03:13 -0400" (RFC 2822)
    if not raw:
        return None
    dt = parsedate_to_datetime(raw)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class BenzingaSource(NewsSource):
    """Stage B only -- ticker-scoped via tickers= (validated working). The
    channels= topic filter was tested and found to be silently ignored on
    this plan (see source evaluation), so Benzinga isn't part of Stage A."""

    name = "benzinga"
    min_delay_seconds = 0.5  # generous rate limit observed (4000/min)

    def __init__(self, api_key: str = None):
        self.api_key = api_key or config.BENZINGA_API_KEY
        if not self.api_key:
            raise ValueError("BENZINGA_API_KEY not set (check .env)")

    def fetch(self, ticker: str, max_results: int = 20, lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> list[Article]:
        # Without an explicit date range, Benzinga's endpoint defaults to a
        # recency-biased window -- a ticker with no news in the last few
        # hours (found empirically: TSLA, NVDA at one point in testing, while
        # AAPL/MSFT had same-day stories) returns [] even though it clearly
        # has news within a normal lookback period. An explicit dateFrom
        # makes results consistent regardless of a ticker's news cadence.
        date_from = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
        resp = get_with_retry(BASE_URL, params={
            "token": self.api_key,
            "tickers": ticker,
            "pagesize": max_results,
            "dateFrom": date_from,
        }, headers={"Accept": "application/json"})
        data = resp.json()

        articles = []
        for item in data:
            articles.append(Article(
                source=self.name,
                stage="B",
                query_context=ticker,
                source_article_id=str(item.get("id")) if item.get("id") is not None else None,
                url=item.get("url"),
                title=item.get("title"),
                summary=item.get("teaser") or None,
                author=item.get("author"),
                published_at=_benzinga_date_to_iso(item.get("created")),
                raw_payload=item,
            ))
        return articles
