from __future__ import annotations

from pydantic import BaseModel

from .. import config
from .historical_factors import FACTOR_LABELS, build_historical_scorecard

# Same model already in production use elsewhere (src/sentiment/llm_sentiment.py,
# src/valuation/peer_selection.py) -- kept as its own literal per those
# modules' convention of staying independent of each other.
MODEL_NAME = "gemini-flash-lite-latest"

PERCENT_METRICS = {"fcf_yield", "operating_margin", "return_on_equity", "revenue_growth", "eps_growth"}
MULTIPLE_METRICS = {"trailing_pe", "ev_to_ebitda", "price_to_book", "debt_to_equity", "cash_conversion"}


def _format_value(key: str, value) -> str:
    if value is None:
        return "n/a"
    if key in PERCENT_METRICS:
        return f"{value * 100:.1f}%"
    if key in MULTIPLE_METRICS:
        return f"{value:.2f}x"
    return f"{value:.2f}"


class ValuationRationale(BaseModel):
    value: str
    quality: str
    growth: str
    momentum: str


PROMPT = """You are an institutional equity analyst writing a brief comparative rationale for {ticker} \
against its peers ({peer_list}), one paragraph per factor below.

GROUNDING CONTRACT: your only source of fact is the metric evidence given below. You may have prior \
knowledge about {ticker} and its peers from training -- real investments, partnerships, product launches, \
capex programs, management commentary. DO NOT use any of it here; this is a pure numbers exercise. Every \
number you write must be copied from a number that appears below -- never compute, estimate, or introduce a \
new one, and never cite a catalyst, event, or reason that isn't one of the metrics given.

Frame every paragraph from {ticker}'s perspective: is it ahead or behind peers on this factor, and which \
specific metrics explain why. Each z-score is already direction-adjusted so positive always means \
favorable, comparable across metrics. 2-3 sentences per factor, in the flat precise register of an \
institutional research note -- interpret the numbers, don't just restate them, and don't dress up a metric \
comparison with a narrative reason that isn't in the data.

{factor_blocks}
"""


def _factor_block(factor_key: str, label: str, companies: list[dict]) -> str:
    lines = [f"## {label}"]
    target = companies[0]
    metrics = target["factors"].get(factor_key, {}).get("raw", {})
    for metric_key, m in metrics.items():
        parts = [f"{m['label']}: {target['ticker']}={_format_value(metric_key, m.get('current'))} (z={m.get('zscore')})"]
        for peer in companies[1:]:
            pm = peer["factors"].get(factor_key, {}).get("raw", {}).get(metric_key)
            if pm:
                parts.append(f"{peer['ticker']}={_format_value(metric_key, pm.get('current'))} (z={pm.get('zscore')})")
            else:
                parts.append(f"{peer['ticker']}=n/a")
        lines.append(" · ".join(parts))
    return "\n".join(lines)


def generate_valuation_rationale(ticker: str, peer_tickers: list[str]) -> dict:
    """Fetches each company's historical factor scorecard (cached inside
    build_historical_scorecard -- see historical_factors.py) and asks one LLM
    call for a target-vs-peers rationale per factor, grounded strictly in the
    metric evidence assembled here. A peer whose data fails to fetch is
    silently dropped from the comparison rather than failing the whole call
    -- the target itself has already loaded successfully by the time this
    runs (it's on screen elsewhere on the same page)."""
    from google import genai

    companies = [{"ticker": ticker, "factors": build_historical_scorecard(ticker)["factors"]}]
    for peer in peer_tickers:
        try:
            companies.append({"ticker": peer, "factors": build_historical_scorecard(peer)["factors"]})
        except Exception:
            continue

    factor_blocks = "\n\n".join(_factor_block(key, label, companies) for key, label in FACTOR_LABELS.items())
    prompt = PROMPT.format(
        ticker=ticker, peer_list=", ".join(c["ticker"] for c in companies[1:]) or "(none available)",
        factor_blocks=factor_blocks,
    )

    client = genai.Client(api_key=config.GOOGLE_API_KEY)
    response = client.models.generate_content(
        model=MODEL_NAME, contents=prompt,
        config={"response_mime_type": "application/json", "response_schema": ValuationRationale, "temperature": 0.3},
    )
    return response.parsed.model_dump()
