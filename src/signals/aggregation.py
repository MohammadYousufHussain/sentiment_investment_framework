from __future__ import annotations

from datetime import datetime, timezone

# (name, min_days, max_days) -- see architecture doc §4 for why these three
# windows (not per-day buckets) were chosen: Mid combines what would
# otherwise be two thin buckets into one that reliably clears MIN_VOLUME_THRESHOLD.
WINDOWS = [
    ("recent", 0, 3),
    ("mid", 4, 14),
    ("historical", 15, 30),
]
MIN_VOLUME_THRESHOLD = 3


def _age_days(published_at: str, now=None):
    if not published_at:
        return None
    try:
        dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    return max(0.0, (now - dt).total_seconds() / 86400)


def assign_window(age_days: float):
    for name, min_days, max_days in WINDOWS:
        if min_days <= age_days <= max_days:
            return name
    if age_days > WINDOWS[-1][2]:
        return "historical"  # anything older still rolls into historical
    return None


def bucket_articles(scored_articles: list[dict], now=None) -> dict[str, list[dict]]:
    """scored_articles: [{'published_at': str, 'rank': int, 'confidence': float}, ...].
    Returns {'recent': [...], 'mid': [...], 'historical': [...]}."""
    buckets = {name: [] for name, _, _ in WINDOWS}
    for a in scored_articles:
        age = _age_days(a["published_at"], now=now)
        if age is None:
            continue
        window = assign_window(age)
        if window:
            buckets[window].append(a)
    return buckets


def window_stats(articles_in_window: list[dict]) -> dict:
    """Confidence-weighted mean rank + volume. insufficient_data=True below
    MIN_VOLUME_THRESHOLD -- callers must not treat mean_rank as reliable when
    this is set (see architecture doc §4).

    `confidence` here is already relevance-weighted (an Incidental article's
    confidence is 0 -- see sentiment ensemble's RELEVANCE_WEIGHT), so a window
    where every article happens to be Incidental has total_weight == 0. That's
    treated as insufficient_data too, not silently averaged as an unweighted
    mean -- a zero-weight article was deliberately excluded, not missing data
    to paper over."""
    count = len(articles_in_window)
    if count == 0:
        return {"count": 0, "mean_rank": None, "insufficient_data": True}

    total_weight = sum(a["confidence"] for a in articles_in_window)
    if total_weight <= 0:
        return {"count": count, "mean_rank": None, "insufficient_data": True}

    mean_rank = sum(a["rank"] * a["confidence"] for a in articles_in_window) / total_weight

    return {
        "count": count,
        "mean_rank": round(mean_rank, 3),
        "insufficient_data": count < MIN_VOLUME_THRESHOLD,
    }
