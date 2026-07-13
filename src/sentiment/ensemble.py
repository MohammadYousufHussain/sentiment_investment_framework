from __future__ import annotations

LABEL_RANK = {"Bearish": -2, "Somewhat-Bearish": -1, "Neutral": 0, "Somewhat-Bullish": 1, "Bullish": 2}

# The overall/combined score uses the LLM's judgment alone, discounted by its
# own relevance call: an article where the ticker is Incidental contributes
# nothing to the ticker's aggregate sentiment, Secondary counts at half
# weight, Primary at full weight. See architecture doc §4 (updated) for why
# this replaced the earlier FinBERT/LLM noisy-OR-style combination -- FinBERT
# has no relevance signal of its own to weight by, and folding it into the
# combined score had no principled way to apply this discount to it too.
RELEVANCE_WEIGHT = {"Primary": 1.0, "Secondary": 0.5, "Incidental": 0.0}


def combine_article_sentiment(rows: list[dict]):
    """rows: article_sentiment rows for ONE article (up to one per method).
    Returns {label, confidence, relevance, relevance_weight, agreement,
    finbert, llm} or None if there's no LLM row (relevance-weighting requires
    the LLM's own relevance call -- FinBERT has nothing to weight by).

    FinBERT is still run, stored, and shown in its own column/QA cross-check
    -- `agreement` (still computed here when both rows exist) reports whether
    it lines up with the LLM, but no longer changes the combined label or
    confidence itself."""
    by_method = {r["method"]: r for r in rows}
    llm = by_method.get("llm")
    finbert = by_method.get("finbert")

    if not llm:
        return None

    relevance = llm.get("relevance")
    weight = RELEVANCE_WEIGHT.get(relevance, 1.0)  # rows predating the relevance field default to full weight
    combined_confidence = round(llm["confidence"] * weight, 4)

    agreement = None
    if finbert:
        distance = abs(LABEL_RANK[finbert["label"]] - LABEL_RANK[llm["label"]])
        agreement = "agree" if distance <= 1 else "conflict"

    return {
        "label": llm["label"],
        "confidence": combined_confidence,
        "relevance": relevance,
        "relevance_weight": weight,
        "agreement": agreement,
        "finbert": finbert,
        "llm": llm,
    }


def summarize_ticker_sentiment(article_results: list[dict]) -> dict:
    """article_results: the combine_article_sentiment() output for every
    scored article for one ticker. A simple, transparent rollup -- not the
    time-series/signal-detection phase (built separately), just a snapshot.

    label_counts / articles_scored reflect every LLM-scored article
    regardless of relevance weight (an Incidental article still shows up
    here -- it's just zero-weighted in the window/signal aggregation
    downstream, see src/signals/aggregation.py). agreement_rate is a FinBERT
    cross-check only, independent of the relevance-weighted combined score."""
    label_counts = {label: 0 for label in LABEL_RANK}
    agree_count = 0
    conflict_count = 0

    for r in article_results:
        if r is None:
            continue
        label_counts[r["label"]] += 1
        if r["agreement"] == "agree":
            agree_count += 1
        elif r["agreement"] == "conflict":
            conflict_count += 1

    total_dual_method = agree_count + conflict_count
    return {
        "label_counts": label_counts,
        "agreement_rate": (agree_count / total_dual_method) if total_dual_method else None,
        "conflict_count": conflict_count,
        "articles_scored": sum(1 for r in article_results if r is not None),
    }
