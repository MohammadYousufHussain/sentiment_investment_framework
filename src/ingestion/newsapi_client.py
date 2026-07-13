from __future__ import annotations

from .. import config
from .base import Article, NewsSource
from .http_utils import get_with_retry

BASE_URL = "https://newsapi.org/v2/everything"


class NewsAPISource(NewsSource):
    name = "newsapi"
    min_delay_seconds = 1.0

    def __init__(self, api_key: str = None):
        self.api_key = api_key or config.NEWSAPI_KEY
        if not self.api_key:
            raise ValueError("NEWSAPI_KEY not set (check .env)")

    def fetch(self, query: str, max_results: int = 20, stage: str = "A") -> list[Article]:
        """query is a free-text keyword for Stage A, or a company name for
        Stage B (ticker-scoped) -- identical API call either way."""
        resp = get_with_retry(BASE_URL, params={
            "q": query,
            "language": "en",
            "sortBy": "relevancy",
            "pageSize": max_results,
            "apiKey": self.api_key,
        })
        data = resp.json()

        articles = []
        for a in data.get("articles", []):
            articles.append(Article(
                source=self.name,
                stage=stage,
                query_context=query,
                url=a.get("url"),
                title=a.get("title"),
                summary=a.get("description"),
                author=(a.get("source") or {}).get("name"),
                published_at=a.get("publishedAt"),
                raw_payload=a,
            ))
        return articles
