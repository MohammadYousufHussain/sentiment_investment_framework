from __future__ import annotations

import numpy as np


def zscore(values: list[float | None]) -> list[float | None]:
    """Cross-sectional z-score across a peer set. Ported from equity_research's
    momentum/scoring.py _z_score -- same ddof=1 sample-std convention. None/NaN/
    inf inputs stay None in the output rather than being dropped, so the
    output list stays index-aligned with the input."""
    valid = [v for v in values if v is not None and not np.isnan(v) and not np.isinf(v)]
    if len(valid) < 2:
        return [None] * len(values)
    mu = float(np.mean(valid))
    sd = float(np.std(valid, ddof=1))
    if sd < 1e-10:
        return [0.0 if v is not None else None for v in values]
    return [
        round((v - mu) / sd, 4) if (v is not None and not np.isnan(v) and not np.isinf(v)) else None
        for v in values
    ]


def percentile_ranks(scores: dict[str, float | None]) -> dict[str, float | None]:
    """scores: {ticker: composite_score}, higher = better. Returns
    {ticker: percentile}, 100 = best in the peer set, ported from
    equity_research's momentum/scoring.py rank-to-percentile formula."""
    ranked = sorted(
        [(t, s) for t, s in scores.items() if s is not None],
        key=lambda item: item[1], reverse=True,
    )
    n = len(ranked)
    result: dict[str, float | None] = {t: None for t in scores}
    for rank, (ticker, _) in enumerate(ranked, start=1):
        result[ticker] = round((n - rank) / n * 100, 1) if n > 1 else 50.0
    return result
