from __future__ import annotations

from .. import config
from .base import Article, NewsSource
from .http_utils import get_with_retry
from .date_utils import struct_time_to_iso

import time as _time

BASE_URL = "https://www.alphavantage.co/query"

# Alpha Vantage's NEWS_SENTIMENT `topics` param is a fixed taxonomy, not free text.
# Map common free-text keywords to the nearest fixed topic; fall back to
# `financial_markets` for anything unmapped.
TOPIC_MAP = {
    "renewable energy": "energy_transportation",
    "energy": "energy_transportation",
    "oil": "energy_transportation",
    "earnings": "earnings",
    "ipo": "ipo",
    "merger": "mergers_and_acquisitions",
    "acquisition": "mergers_and_acquisitions",
    "technology": "technology",
    "tech": "technology",
    "biotech": "life_sciences",
    "real estate": "real_estate",
    "retail": "retail_wholesale",
    "manufacturing": "manufacturing",
    "finance": "finance",
    "crypto": "blockchain",
    "blockchain": "blockchain",
    "economy": "economy_macro",
    "fed": "economy_monetary",
}


def map_to_av_topic(query: str) -> str:
    q = query.lower().strip()
    if q in TOPIC_MAP:
        return TOPIC_MAP[q]
    for keyword, topic in TOPIC_MAP.items():
        if keyword in q:
            return topic
    return "financial_markets"


def _av_time_to_iso(t: str) -> str:
    # Alpha Vantage format: YYYYMMDDTHHMM(SS)
    parsed = _time.strptime(t[:15], "%Y%m%dT%H%M%S")
    return struct_time_to_iso(parsed)


class AlphaVantageSource(NewsSource):
    name = "alpha_vantage"
    min_delay_seconds = 1.0  # premium tier allows 75/min; this is a comfortable margin

    def __init__(self, api_key: str = None):
        self.api_key = api_key or config.ALPHA_VANTAGE_API_KEY
        if not self.api_key:
            raise ValueError("ALPHA_VANTAGE_API_KEY not set (check .env)")

    def fetch(self, query: str, max_results: int = 50) -> list[Article]:
        """Stage A: query is a free-text topic, mapped to AV's fixed taxonomy."""
        topic = map_to_av_topic(query)
        resp = get_with_retry(BASE_URL, params={
            "function": "NEWS_SENTIMENT",
            "topics": topic,
            "limit": max_results,
            "apikey": self.api_key,
        })
        return self._parse_feed(resp.json(), query_context=query, stage="A")

    def fetch_by_ticker(self, ticker: str, max_results: int = 50) -> list[Article]:
        """Stage B: ticker-scoped via AV's native tickers= param (its primary/
        default mode -- topics= was the Stage A workaround). Already gives
        provider sentiment natively, same as Stage A."""
        resp = get_with_retry(BASE_URL, params={
            "function": "NEWS_SENTIMENT",
            "tickers": ticker,
            "limit": max_results,
            "apikey": self.api_key,
        })
        return self._parse_feed(resp.json(), query_context=ticker, stage="B")

    def _parse_feed(self, data: dict, query_context: str, stage: str) -> list[Article]:
        articles = []
        for a in data.get("feed", []):
            articles.append(Article(
                source=self.name,
                stage=stage,
                query_context=query_context,
                url=a.get("url"),
                title=a.get("title"),
                summary=a.get("summary"),
                author=a.get("source"),
                published_at=_av_time_to_iso(a["time_published"]) if a.get("time_published") else None,
                provider_sentiment_label=a.get("overall_sentiment_label"),
                provider_sentiment_score=a.get("overall_sentiment_score"),
                raw_payload=a,
            ))
        return articles
