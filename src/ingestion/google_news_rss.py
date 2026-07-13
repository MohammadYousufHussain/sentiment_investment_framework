from __future__ import annotations

from urllib.parse import quote

import feedparser
from bs4 import BeautifulSoup

from .base import Article, NewsSource
from .date_utils import struct_time_to_iso


def _clean_summary(raw_html: str, title: str) -> str | None:
    """Google's RSS 'summary' is just an HTML blob wrapping the title as a link
    plus the publisher name (e.g. '<a href=...>Title</a>&nbsp;&nbsp;<font>Pub</font>'),
    not real article content. Strip the markup, and drop it entirely if all that's
    left duplicates the title -- storing that as a fake 'summary' would be noise,
    not information."""
    if not raw_html:
        return None
    text = BeautifulSoup(raw_html, "html.parser").get_text(separator=" ").strip()
    text = " ".join(text.split())
    if not text or text.strip().lower() == (title or "").strip().lower():
        return None
    return text


class GoogleNewsRSSSource(NewsSource):
    name = "google_news_rss"
    min_delay_seconds = 1.0

    def fetch(self, query: str, max_results: int = 20, stage: str = "A") -> list[Article]:
        """query is a free-text keyword for Stage A, or a company name for
        Stage B (ticker-scoped) -- this client's HTTP call is identical
        either way, only the stage tag on the stored Article differs."""
        url = f"https://news.google.com/rss/search?q={quote(query)}&hl=en-US&gl=US&ceid=US:en"
        feed = feedparser.parse(url)

        articles = []
        for entry in feed.entries[:max_results]:
            source_name = None
            if hasattr(entry, "source"):
                source_name = getattr(entry.source, "title", None) if hasattr(entry.source, "title") else entry.source.get("title")

            title = entry.get("title")
            articles.append(Article(
                source=self.name,
                stage=stage,
                query_context=query,
                url=entry.get("link"),
                title=title,
                summary=_clean_summary(entry.get("summary"), title),
                author=source_name,
                published_at=struct_time_to_iso(entry.get("published_parsed")),
                raw_payload=dict(entry),
            ))
        return articles
