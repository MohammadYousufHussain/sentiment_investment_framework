from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import trafilatura
from googlenewsdecoder import gnewsdecoder

logger = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (compatible; SentimentInvestmentBot/1.0; +research use)"
MIN_TEXT_LENGTH = 200  # shorter than this isn't worth treating as "full text"


def resolve_real_url(source: str, url: str) -> str:
    """Google News RSS links are redirect pages that resolve via a client-side
    JS mechanism, not a plain HTTP redirect -- scraping them directly gets
    Google's shell page, not the article. gnewsdecoder replicates the internal
    call Google's own frontend makes to resolve the real publisher URL."""
    if source != "google_news_rss":
        return url
    try:
        result = gnewsdecoder(url, interval=1)
        if result.get("status") and result.get("decoded_url"):
            return result["decoded_url"]
    except Exception as exc:
        logger.debug("gnewsdecoder failed for %s: %s", url, exc)
    return url


def extract_full_text(source: str, url: str, timeout: int = 10):
    """Best-effort full article text extraction. Returns (full_text_or_None, status).
    Failures (paywalls, 403s, non-HTML, JS-only pages) are expected and common --
    this never raises, it just reports why it didn't get text."""
    try:
        real_url = resolve_real_url(source, url)
        resp = requests.get(real_url, timeout=timeout, headers={"User-Agent": USER_AGENT})
        resp.raise_for_status()
        text = trafilatura.extract(resp.text, include_comments=False, include_tables=False)
        if text and len(text) >= MIN_TEXT_LENGTH:
            return text, "success"
        return None, "extract_empty"
    except requests.HTTPError as exc:
        return None, f"http_error_{exc.response.status_code if exc.response is not None else 'unknown'}"
    except requests.RequestException:
        return None, "fetch_error"
    except Exception:
        return None, "error"


def extract_full_text_batch(items: list, max_workers: int = 6) -> dict:
    """items: list of (article_id, source, url). Returns {article_id: (full_text, status)}.
    Scraping is I/O-bound (one HTTP round-trip per article), so a thread pool keeps
    wall-clock time reasonable instead of scraping tens of articles one at a time."""
    results = {}
    if not items:
        return results

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_id = {
            executor.submit(extract_full_text, source, url): article_id
            for article_id, source, url in items
        }
        for future in as_completed(future_to_id):
            article_id = future_to_id[future]
            try:
                results[article_id] = future.result()
            except Exception as exc:
                results[article_id] = (None, f"error:{exc}")
    return results
