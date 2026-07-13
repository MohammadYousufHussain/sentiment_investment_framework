from __future__ import annotations


def get_av_ticker_sentiment(raw_payload: dict, ticker: str):
    for t in raw_payload.get("ticker_sentiment", []):
        if t.get("ticker") == ticker:
            label = t.get("ticker_sentiment_label")
            score = t.get("ticker_sentiment_score")
            return label, (float(score) if score is not None else None)
    return None, None


def compare_article(source: str, raw_payload: dict, ticker: str, our_label: str):
    """QA comparison only -- never fed back into our own labels/confidence
    (same principle as the NER benchmark). Alpha Vantage's ticker_sentiment
    labels already use the exact same 5-tier scale we do, so this is a
    direct string comparison, not a fuzzy mapping."""
    if source != "alpha_vantage":
        return None
    av_label, av_score = get_av_ticker_sentiment(raw_payload, ticker)
    if av_label is None:
        return None
    return {
        "av_label": av_label,
        "av_score": av_score,
        "our_label": our_label,
        "agree": av_label == our_label,
    }
