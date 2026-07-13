from __future__ import annotations

DEFAULT_SELECT_MENTION_THRESHOLD = 2
DEFAULT_SELECT_CONFIDENCE_THRESHOLD = 0.85

# Relevance is a DIFFERENT question from confidence (see architecture doc §5b):
# confidence asks "is this really company X", relevance asks "does this article
# actually connect company X to the search topic, or just mention it in passing".
# Only LLM rows carry a relevance judgment (folded into the same call that does
# extraction -- see llm_extractor.py); spacy_fuzzy rows have relevance=None.
RELEVANCE_RANK = {"Low": 1, "Medium": 2, "High": 3}


def noisy_or(confidences: list[float]) -> float:
    """Combine independent per-method confidences into the probability that at
    least one of them is correct -- rewards agreement between methods rather
    than diluting it the way a plain average would (see architecture doc §5)."""
    product = 1.0
    for c in confidences:
        product *= (1 - c)
    return 1 - product


def combine_article_entities(rows: list[dict]) -> dict[str, dict]:
    """rows: article_entities rows (ticker, method, confidence, company_name,
    relevance) for ONE article. Returns {ticker: {combined_confidence, methods,
    company_name, relevance}} -- Layer 2 of the confidence design."""
    by_ticker: dict[str, dict] = {}
    for r in rows:
        ticker = r["ticker"]
        entry = by_ticker.setdefault(ticker, {
            "confidences": [], "methods": set(), "company_name": r["company_name"], "relevance": None,
        })
        entry["confidences"].append(r["confidence"])
        entry["methods"].add(r["method"])
        relevance = r.get("relevance")
        if relevance and (entry["relevance"] is None or RELEVANCE_RANK[relevance] > RELEVANCE_RANK[entry["relevance"]]):
            entry["relevance"] = relevance

    return {
        ticker: {
            "combined_confidence": noisy_or(v["confidences"]),
            "methods": v["methods"],
            "company_name": v["company_name"],
            "relevance": v["relevance"],
        }
        for ticker, v in by_ticker.items()
    }


def rollup_candidates(article_entity_rows_by_article: dict[int, list[dict]]) -> list[dict]:
    """Layer 3: aggregate per-article combined confidences into the per-search
    candidate list a user actually reviews. mention_count, best_confidence, and
    best_relevance are surfaced separately rather than blended into one score
    (see architecture doc §5) so the default-selection rule stays auditable."""
    per_ticker: dict[str, dict] = {}

    for article_id, rows in article_entity_rows_by_article.items():
        combined = combine_article_entities(rows)
        for ticker, info in combined.items():
            agg = per_ticker.setdefault(ticker, {
                "ticker": ticker,
                "company_name": info["company_name"],
                "mention_count": 0,
                "best_confidence": 0.0,
                "best_relevance": None,
                "methods": set(),
                "article_ids": [],
            })
            agg["mention_count"] += 1
            agg["best_confidence"] = max(agg["best_confidence"], info["combined_confidence"])
            if info["relevance"] and (
                agg["best_relevance"] is None or RELEVANCE_RANK[info["relevance"]] > RELEVANCE_RANK[agg["best_relevance"]]
            ):
                agg["best_relevance"] = info["relevance"]
            agg["methods"] |= info["methods"]
            agg["article_ids"].append(article_id)

    candidates = []
    for agg in per_ticker.values():
        meets_volume_bar = (
            agg["mention_count"] >= DEFAULT_SELECT_MENTION_THRESHOLD
            or agg["best_confidence"] >= DEFAULT_SELECT_CONFIDENCE_THRESHOLD
        )
        # best_relevance is None when the LLM never independently found this
        # ticker (only spacy_fuzzy did) -- that's "not assessed", not "low", so
        # it doesn't gate selection; only an explicit "Low" judgment does.
        not_low_relevance = agg["best_relevance"] != "Low"
        candidates.append({
            **agg,
            "methods": sorted(agg["methods"]),
            "article_ids": sorted(agg["article_ids"]),
            "default_selected": meets_volume_bar and not_low_relevance,
        })

    candidates.sort(key=lambda c: (-c["best_confidence"], -c["mention_count"]))
    return candidates
