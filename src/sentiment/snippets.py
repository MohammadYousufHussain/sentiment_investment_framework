from __future__ import annotations

import re

from ..ner.reference_data import normalize_company_name

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT_RE.split(text) if s.strip()]


def extract_ticker_snippets(text: str, ticker: str, company_name: str, max_sentences: int = 8) -> tuple[list[str], bool]:
    """Returns (snippets, matched). matched=False means no sentence actually
    mentioned the ticker/company -- the caller gets the article's opening
    sentences as a best-effort fallback instead of nothing, but should treat
    that result as lower quality (not ticker-specific)."""
    sentences = split_sentences(text)
    if not sentences:
        return [], False

    core_name = normalize_company_name(company_name)
    primary_name = core_name.split()[0] if core_name else None

    ticker_re = re.compile(rf"\b{re.escape(ticker)}\b")
    name_re = re.compile(re.escape(primary_name), re.IGNORECASE) if primary_name and len(primary_name) >= 3 else None

    matched = [s for s in sentences if ticker_re.search(s) or (name_re and name_re.search(s))]
    if matched:
        return matched[:max_sentences], True
    return sentences[:max_sentences], False
