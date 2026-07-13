from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class Article:
    source: str
    stage: str  # 'A' or 'B'
    query_context: str
    url: str
    title: str
    source_article_id: Optional[str] = None
    summary: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[str] = None  # ISO 8601 UTC
    provider_sentiment_label: Optional[str] = None
    provider_sentiment_score: Optional[float] = None
    raw_payload: Any = field(default=None)

    def as_dict(self) -> dict:
        return {
            "source": self.source,
            "stage": self.stage,
            "query_context": self.query_context,
            "url": self.url,
            "title": self.title,
            "source_article_id": self.source_article_id,
            "summary": self.summary,
            "author": self.author,
            "published_at": self.published_at,
            "provider_sentiment_label": self.provider_sentiment_label,
            "provider_sentiment_score": self.provider_sentiment_score,
            "raw_payload": self.raw_payload,
        }


class NewsSource(ABC):
    """Common interface for a Stage A (keyword-driven) news source."""

    name: str = "base"
    min_delay_seconds: float = 1.0

    @abstractmethod
    def fetch(self, query: str, max_results: int = 20) -> list[Article]:
        """Fetch articles matching a free-text (or nearest-fixed-topic) query."""
        raise NotImplementedError
