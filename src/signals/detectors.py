from __future__ import annotations

INFLECTION_THRESHOLD = 1.0   # a full label-category jump (see architecture doc §5)
POSITIVE_THRESHOLD = 0.5
NEGATIVE_THRESHOLD = -0.5


def _reliability(count_a: int, count_b: int) -> str:
    """Combined-volume reliability tag (see architecture doc §6) -- a signal
    is never presented without this, since two 3-article windows and two
    40-article windows are not equally trustworthy claims."""
    if count_a >= 10 and count_b >= 10:
        return "Strong"
    if count_a >= 5 and count_b >= 5:
        return "Moderate"
    return "Weak"


def detect_sharp_inflection(recent: dict, mid: dict):
    if recent["insufficient_data"] or mid["insufficient_data"]:
        return None
    delta = recent["mean_rank"] - mid["mean_rank"]
    if abs(delta) >= INFLECTION_THRESHOLD:
        return {
            "type": "sharp_inflection",
            "direction": "up" if delta > 0 else "down",
            "delta": round(delta, 3),
            "reliability": _reliability(recent["count"], mid["count"]),
        }
    return None


def detect_sustained(recent: dict, mid: dict):
    if recent["insufficient_data"] or mid["insufficient_data"]:
        return None
    if recent["mean_rank"] >= POSITIVE_THRESHOLD and mid["mean_rank"] >= POSITIVE_THRESHOLD:
        return {"type": "sustained_positivity", "reliability": _reliability(recent["count"], mid["count"])}
    if recent["mean_rank"] <= NEGATIVE_THRESHOLD and mid["mean_rank"] <= NEGATIVE_THRESHOLD:
        return {"type": "sustained_negativity", "reliability": _reliability(recent["count"], mid["count"])}
    return None


def detect_turnaround(recent: dict, mid: dict):
    if recent["insufficient_data"] or mid["insufficient_data"]:
        return None
    if mid["mean_rank"] <= NEGATIVE_THRESHOLD and recent["mean_rank"] >= POSITIVE_THRESHOLD:
        return {"type": "negative_to_positive_turnaround", "reliability": _reliability(recent["count"], mid["count"])}
    if mid["mean_rank"] >= POSITIVE_THRESHOLD and recent["mean_rank"] <= NEGATIVE_THRESHOLD:
        return {"type": "positive_to_negative_turnaround", "reliability": _reliability(recent["count"], mid["count"])}
    return None


def detect_all(windows: dict) -> list[dict]:
    recent = windows.get("recent")
    mid = windows.get("mid")
    if not recent or not mid:
        return []

    signals = []
    for detector in (detect_sharp_inflection, detect_sustained, detect_turnaround):
        result = detector(recent, mid)
        if result:
            signals.append(result)
    return signals
