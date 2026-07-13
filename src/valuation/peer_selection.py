from __future__ import annotations

import threading
import time

from pydantic import BaseModel

from .. import config
from .qis_factors import _fetch_snapshot_cached
from .sector_peers import SECTOR_PEERS

# Same model already in production use for article sentiment (src/sentiment/
# llm_sentiment.py) -- kept as its own literal here rather than a shared
# import so the valuation and sentiment subpackages stay independent of
# each other; if the model choice drifts between the two uses that's fine,
# they're unrelated calls.
MODEL_NAME = "gemini-flash-lite-latest"

# Peer relationships don't shift week to week the way sentiment or price
# does -- cached far longer than the qis_factors snapshot cache (15min) to
# avoid burning an LLM call on every Comparables page view.
CACHE_TTL_SECONDS = 6 * 3600

_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()

PROMPT = """You are selecting comparable peer companies for equity analysis.

Subject company: {company_name} (ticker: {ticker})
Sector: {sector}
Industry: {industry}

Candidate peers from the same broad sector (a curated large/mid-cap list, not \
exhaustive): {candidates}

Suggest exactly {n} peer companies that are the most relevant, direct comparables for \
{company_name} -- prefer companies in the same specific industry / sub-sector and \
business model over ones that merely share the broad sector above. You may pick from \
the candidate list, or suggest a better comparable if you know one, as long as it is a \
real, currently publicly-listed company with a valid stock ticker. Do not suggest \
{company_name} itself.

For each, give:
- ticker: the stock ticker
- company_name: the company's common name
- reason: one short sentence on why it's a relevant comp for {company_name}
"""


class PeerSuggestion(BaseModel):
    ticker: str
    company_name: str
    reason: str


class PeerSuggestions(BaseModel):
    peers: list[PeerSuggestion]


def _call_llm(company_name: str, ticker: str, sector: str | None, industry: str | None, candidates: list[str], n: int) -> list[dict]:
    from google import genai

    client = genai.Client(api_key=config.GOOGLE_API_KEY)
    prompt = PROMPT.format(
        company_name=company_name, ticker=ticker,
        sector=sector or "Unknown", industry=industry or "Unknown",
        candidates=", ".join(candidates) if candidates else "(none available)",
        n=n,
    )
    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt,
        config={"response_mime_type": "application/json", "response_schema": PeerSuggestions},
    )
    parsed: PeerSuggestions = response.parsed
    return [p.model_dump() for p in parsed.peers[:n]]


def suggest_peers(ticker: str, n: int = 3, refresh: bool = False) -> dict:
    """Sector/industry as a light-touch rule-based candidate pool, refined by
    a single LLM call into the `n` most relevant direct comps -- not the
    ~10-name cross-sectional universe qis_factors z-scores against, a short,
    curated shortlist meant for a side-by-side comparison. Cached per ticker
    since peer relationships are slow-moving and this costs a real LLM call."""
    ticker = ticker.upper()
    now = time.time()
    if not refresh:
        with _cache_lock:
            cached = _cache.get(ticker)
            if cached and now - cached[0] < CACHE_TTL_SECONDS:
                return cached[1]

    snapshot = _fetch_snapshot_cached(ticker)
    info = snapshot["info"]
    company_name = info.get("longName") or info.get("shortName") or ticker
    sector = info.get("sector")
    industry = info.get("industry")

    candidates = [t for t in SECTOR_PEERS.get(sector, []) if t != ticker]
    peers = _call_llm(company_name, ticker, sector, industry, candidates, n)

    result = {
        "ticker": ticker,
        "company_name": company_name,
        "sector": sector,
        "industry": industry,
        "peers": peers,
    }
    with _cache_lock:
        _cache[ticker] = (now, result)
    return result
