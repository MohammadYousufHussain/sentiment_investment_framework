from __future__ import annotations

import threading
import time

from pydantic import BaseModel

from .. import config
from ..db.database import Database
from ..signals.pipeline import analyze_signals
from ..signals.rationale import generate_sentiment_rationale
from .peer_selection import suggest_peers
from .rationale import generate_valuation_rationale

MODEL_NAME = "gemini-flash-lite-latest"

# This is the expensive step in the Investment Thesis chain (two chained LLM
# calls plus a scorecard fetch per peer) and, critically, doesn't depend on
# which stance a stock pitch is later built around -- see pitch.py, which
# calls this without forcing a refresh so switching stances only pays for
# its own much cheaper final synthesis call, not this one again.
CACHE_TTL_SECONDS = 1800
_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()

# Same descriptions the frontend shows on the Sentiment & News tab (see
# SignalsCard.jsx SIGNAL_CATALOG) -- restated here in prose since this feeds
# an LLM prompt, not a UI legend.
SIGNAL_DESCRIPTIONS = {
    "sharp_inflection": lambda s: (
        f"Sharp inflection detected: sentiment moved {s['direction']} by {s['delta']:+} between the mid and "
        f"recent windows -- a full category jump, not gradual drift ({s['reliability']} reliability)."
    ),
    "sustained_positivity": lambda s: (
        f"Sustained positivity: both the recent and mid-term windows are solidly positive -- a positive view "
        f"holding steady, not a one-window blip ({s['reliability']} reliability)."
    ),
    "sustained_negativity": lambda s: (
        f"Sustained negativity: both the recent and mid-term windows are solidly negative "
        f"({s['reliability']} reliability)."
    ),
    "negative_to_positive_turnaround": lambda s: (
        f"Turnaround: sentiment flipped from solidly negative (mid-term) to solidly positive (recent) "
        f"({s['reliability']} reliability)."
    ),
    "positive_to_negative_turnaround": lambda s: (
        f"Turnaround: sentiment flipped from solidly positive (mid-term) to solidly negative (recent) "
        f"({s['reliability']} reliability)."
    ),
}


class ThesisCase(BaseModel):
    stance: str
    points: list[str]


class InvestmentThesis(BaseModel):
    base_case: ThesisCase
    bull_case: ThesisCase
    bear_case: ThesisCase


PROMPT = """You are a senior equity analyst at an institutional research desk, writing a three-case \
investment thesis for {ticker} ({company_name}), benchmarked against its closest peers ({peer_list}).

GROUNDING CONTRACT -- read this before writing anything:
- Your ONLY source of fact is the evidence blocks below (valuation/quality/growth/momentum analysis and \
sentiment/news analysis already written by other analysts on your desk, plus detected sentiment signals).
- You have prior knowledge about {ticker} and its peers from training -- e.g. real capex programs, \
partnerships, executive changes, product launches, regulatory or political news. DO NOT use any of it. If \
a fact, catalyst, dollar figure, date, or event is not written out in the evidence below, it does not exist \
for the purposes of this thesis, even if you are confident it is true in the real world.
- Every number you write (a percentage, a ratio, a dollar figure, a z-score) must be copied from a number \
that already appears in the evidence below. Never compute, estimate, round differently, or introduce a new \
number.
- Before finalizing each point, check it against this rule: "can I point to the exact sentence in the \
evidence below that supports this?" If not, cut the point or rewrite it using only what's actually there. \
It is better to write 4 tightly grounded points than 6 where two are invented.

Write exactly three cases:
- BASE CASE: the single most likely path over the next 6-12 months given the current evidence, weighing \
valuation, fundamentals, momentum, and sentiment together. Balanced and specific, not hedged or vague.
- BULL CASE: what would have to go right for meaningful upside beyond the base case. Tie every point to \
something specific in the evidence -- a current weakness closing the gap to peers, a sustained positive \
trend continuing, a valuation discount re-rating, a peer-relative gap narrowing.
- BEAR CASE: what would have to go wrong. Tie every point to something specific in the evidence -- a \
valuation premium vulnerable to compression, a detected negative signal continuing or worsening, a quality/\
growth metric that already lags peers deteriorating further, a peer closing in from behind.

Rules for every case:
- "stance": one sharp sentence stating the case -- no hedging, no "could potentially."
- "points": 4-6 bullet points, each ONE sentence, each grounded in a specific piece of evidence below (name \
the metric, z-score, peer ticker, headline, or detected signal) -- per the grounding contract above. No \
generic boilerplate ("the company faces execution risk") without tying it to the evidence. Don't repeat the \
same point across cases -- the bear case shouldn't just be the bull case negated; each should surface \
DIFFERENT evidence.
- Across the three cases, make sure you've drawn on valuation, quality, growth, momentum, AND sentiment/news \
at least once each -- not just valuation repeated six ways.
- Write in the flat, precise register of an institutional research note: state the mechanism and the \
evidence plainly. Banned words and phrases, in the stance AND every point, with no exceptions: "massive," \
"game-changing," "incredible," "phenomenal," "unprecedented," "remarkable," "structural catalyst," "serves \
as a catalyst," "differentiates ... from peers lacking such scale." If you catch yourself about to write \
one of these, stop and rewrite the sentence around the actual number instead.
- Do not assert that a news event or sentiment catalyst "justifies," "supports," "serves as a catalyst for," \
or "explains" a specific valuation multiple unless the evidence actually gives you the financial mechanism \
connecting them (e.g. an earnings, margin, or growth number that would move the multiple). A news headline \
-- even a genuinely bullish one, even a large dollar figure in an investment announcement -- is a sentiment \
data point, not a valuation argument, until you can state HOW it flows through to the financials. If you \
can't state that mechanism from the evidence given, phrase it as sentiment only: "X is a positive sentiment \
driver" or "X supports near-term sentiment," never "X justifies/supports the Y multiple." Keep sentiment \
points and valuation points in separate lanes unless the evidence explicitly connects them.
- When sentiment evidence involves political commentary or statements by public figures, describe the \
underlying business fact (the investment, deal, or announcement) rather than the political framing -- that's \
a sentiment/news input, not grounds for a political opinion in an equity thesis.

=== VALUATION & FUNDAMENTALS EVIDENCE ({ticker} vs. peers, own-trailing-history z-scores) ===
Value: {value}
Quality: {quality}
Growth: {growth}
Momentum: {momentum}

=== SENTIMENT & NEWS EVIDENCE ({ticker}, by time horizon) ===
Recent (0-3 days): {recent}
Mid-term (4-14 days): {mid}
Historical (15-30 days): {historical}

=== DETECTED SENTIMENT SIGNALS ({ticker}) ===
{signals_block}

=== PEER SET ===
{peer_block}
"""


def _signals_block(signals: list[dict]) -> str:
    if not signals:
        return "No sharp inflections or sustained trends currently detected -- sentiment has been stable across windows."
    lines = [SIGNAL_DESCRIPTIONS[s["type"]](s) for s in signals if s["type"] in SIGNAL_DESCRIPTIONS]
    return "\n".join(f"- {line}" for line in lines)


def generate_investment_thesis(ticker: str, db: Database = None, refresh: bool = False) -> dict:
    """Composes three already-focused analyses -- valuation rationale, news
    sentiment rationale, and detected signals (the same ones the Comparables
    and Sentiment & News tabs use) -- into a single synthesis call rather
    than re-deriving everything from raw metrics again. Keeps this thesis
    consistent with what those tabs already say about the same company,
    and keeps the synthesis prompt focused on judgment (which case is more
    likely, what would move it) rather than re-reading raw numbers.

    Cached per ticker (not per anything else -- this doesn't vary by stance
    or weights) so a second call within CACHE_TTL_SECONDS is free; pass
    refresh=True (the Bull / Bear Case tab's "Regenerate" button) to force a
    fresh chain."""
    ticker = ticker.upper()
    now = time.time()
    if not refresh:
        with _cache_lock:
            cached = _cache.get(ticker)
            if cached and now - cached[0] < CACHE_TTL_SECONDS:
                return cached[1]

    from concurrent.futures import ThreadPoolExecutor

    from google import genai

    db = db or Database()
    peers_info = suggest_peers(ticker)
    peer_tickers = [p["ticker"] for p in peers_info["peers"]]

    with ThreadPoolExecutor(max_workers=2) as pool:
        valuation_future = pool.submit(generate_valuation_rationale, ticker, peer_tickers)
        sentiment_future = pool.submit(generate_sentiment_rationale, ticker, peer_tickers, db)
        valuation = valuation_future.result()
        sentiment = sentiment_future.result()

    signals_result = analyze_signals(ticker, db=db)
    peer_block = "\n".join(f"- {p['ticker']} ({p['company_name']}): {p['reason']}" for p in peers_info["peers"]) \
        or "(no peers identified)"

    prompt = PROMPT.format(
        ticker=ticker, company_name=peers_info["company_name"],
        peer_list=", ".join(peer_tickers) or "(none)",
        value=valuation.get("value", "n/a"), quality=valuation.get("quality", "n/a"),
        growth=valuation.get("growth", "n/a"), momentum=valuation.get("momentum", "n/a"),
        recent=sentiment.get("recent", "n/a"), mid=sentiment.get("mid", "n/a"),
        historical=sentiment.get("historical", "n/a"),
        signals_block=_signals_block(signals_result.get("signals", [])),
        peer_block=peer_block,
    )

    client = genai.Client(api_key=config.GOOGLE_API_KEY)
    response = client.models.generate_content(
        model=MODEL_NAME, contents=prompt,
        config={"response_mime_type": "application/json", "response_schema": InvestmentThesis, "temperature": 0.3},
    )
    result = response.parsed.model_dump()
    result["ticker"] = ticker
    result["company_name"] = peers_info["company_name"]
    result["peers"] = peers_info["peers"]
    # Same recent/mid/historical breakdown (narrative + the specific bullish/
    # bearish articles behind it) already computed above for the prompt --
    # returned as-is so the page can show it directly rather than only the
    # three synthesized cases.
    result["sentiment"] = sentiment
    with _cache_lock:
        _cache[ticker] = (now, result)
    return result
