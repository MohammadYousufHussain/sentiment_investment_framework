from __future__ import annotations

# Only these two Stage A sources carry provider-native ticker tags (see
# architecture/news_ingestion.md §2) -- everything else has nothing to
# benchmark against.
NATIVE_TAG_SOURCES = {"alpha_vantage", "yahoo_search"}


def extract_native_tickers(source: str, raw_payload: dict) -> set[str]:
    if source == "alpha_vantage":
        return {t["ticker"] for t in raw_payload.get("ticker_sentiment", [])}
    if source == "yahoo_search":
        return set(raw_payload.get("relatedTickers") or [])
    return set()


def compare_article(source: str, raw_payload: dict, our_tickers: set[str]):
    """QA comparison only -- never fed back into confidence scoring (see
    architecture doc §2/§7). Returns None for sources with nothing to compare."""
    if source not in NATIVE_TAG_SOURCES:
        return None

    native = extract_native_tickers(source, raw_payload)
    if not native and not our_tickers:
        return None

    agreed = native & our_tickers
    return {
        "native_tickers": sorted(native),
        "our_tickers": sorted(our_tickers),
        "agreed": sorted(agreed),
        "only_native": sorted(native - our_tickers),
        "only_ours": sorted(our_tickers - native),
        "agreement_rate": (len(agreed) / len(native)) if native else None,
    }
