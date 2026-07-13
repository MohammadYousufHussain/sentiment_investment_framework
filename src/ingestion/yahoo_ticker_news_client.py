from __future__ import annotations

import yfinance as yf

from .base import Article, NewsSource


class YahooTickerNewsSource(NewsSource):
    """Stage B only -- yf.Ticker(ticker).news, distinct from YahooSearchSource
    (Stage A's yf.Search). Response items are nested under 'content' (unlike
    yf.Search's flat structure) and include VIDEO items alongside STORY --
    only STORY is kept since video content isn't useful text for NLP."""

    name = "yahoo_ticker_news"
    min_delay_seconds = 1.0

    def fetch(self, ticker: str, max_results: int = 20) -> list[Article]:
        news_items = yf.Ticker(ticker).news

        articles = []
        for item in news_items:
            content = item.get("content") or {}
            if content.get("contentType") != "STORY":
                continue

            url = ((content.get("canonicalUrl") or {}).get("url")
                   or (content.get("clickThroughUrl") or {}).get("url"))

            articles.append(Article(
                source=self.name,
                stage="B",
                query_context=ticker,
                source_article_id=content.get("id") or item.get("id"),
                url=url,
                title=content.get("title"),
                summary=content.get("summary") or None,
                author=(content.get("provider") or {}).get("displayName"),
                published_at=content.get("pubDate"),
                raw_payload=item,
            ))
            if len(articles) >= max_results:
                break
        return articles
