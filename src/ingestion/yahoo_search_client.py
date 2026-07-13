from __future__ import annotations

import yfinance as yf

from .base import Article, NewsSource
from datetime import datetime, timezone


class YahooSearchSource(NewsSource):
    name = "yahoo_search"
    min_delay_seconds = 1.0

    def fetch(self, query: str, max_results: int = 20) -> list[Article]:
        search = yf.Search(query, news_count=max_results)
        news_items = search.news

        articles = []
        for a in news_items:
            published_at = None
            if a.get("providerPublishTime"):
                published_at = datetime.fromtimestamp(a["providerPublishTime"], tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

            articles.append(Article(
                source=self.name,
                stage="A",
                query_context=query,
                source_article_id=a.get("uuid"),
                url=a.get("link"),
                title=a.get("title"),
                summary=None,
                author=a.get("publisher"),
                published_at=published_at,
                raw_payload=a,
            ))
        return articles
