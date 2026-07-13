from __future__ import annotations

import threading
import time
from typing import Literal

from pydantic import BaseModel

from .. import config
from ..db.database import Database
from .thesis import generate_investment_thesis

MODEL_NAME = "gemini-flash-lite-latest"

WINDOW_LABELS = {"recent": "Recent (0-3 days)", "mid": "Mid (4-14 days)", "historical": "Historical (15-30 days)"}
CASE_LABELS = [("base_case", "Base Case"), ("bull_case", "Bull Case"), ("bear_case", "Bear Case")]

# Keyed by (ticker, stance or "auto") -- switching between two stances you've
# already viewed for this ticker is then free, and switching to a new one
# only pays for this module's own synthesis call, since generate_investment_
# thesis() below has its own (much more expensive) cache that this doesn't
# force a refresh of.
CACHE_TTL_SECONDS = 1800
_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_cache_lock = threading.Lock()


class ThesisPillar(BaseModel):
    title: str
    detail: str


class StockPitch(BaseModel):
    recommendation: Literal["Bullish", "Neutral", "Bearish"]
    thesis_statement: str
    pillars: list[ThesisPillar]
    key_risks: list[str]
    catalysts_to_watch: list[str]


STANCES = ("Bullish", "Neutral", "Bearish")
_STANCE_CASE_LABEL = {"Bullish": "BULL", "Bearish": "BEAR", "Neutral": "BASE/hold"}

PROMPT = """You are a senior equity analyst writing a stock pitch memo for {ticker} ({company_name}) -- the \
kind of document you'd bring to an investment committee to argue for a specific stance on the stock. Peers: \
{peer_list}.

GROUNDING CONTRACT -- read before writing:
- Your only source of fact is the Base/Bull/Bear case analysis and sentiment evidence below, already written \
by other analysts on your desk from the underlying metrics and news. Do not introduce any fact, number, \
catalyst, or event that isn't in it. You may have prior knowledge of {ticker} from training -- do not use it, \
even if you're confident it's true.
- Banned words and phrases, no exceptions: "massive," "game-changing," "incredible," "phenomenal," \
"unprecedented," "remarkable," "structural catalyst," "serves as a catalyst for." If a claim needs one of \
these to sound compelling, it isn't grounded enough to include.
- Do not assert that a news event or sentiment reading "justifies," "supports," or "explains" a valuation \
multiple unless the evidence below actually states the financial mechanism connecting them. Keep sentiment \
claims and valuation claims in separate lanes unless the evidence explicitly connects them.
- If a headline involves political commentary or a public figure's statement, refer to the underlying \
business fact, not the political framing.

{stance_instruction}

Write:
- "recommendation": exactly one of "Bullish", "Neutral", "Bearish" (see instruction above for which one).
- "thesis_statement": 2-3 sentences -- the elevator pitch for that stance, stated plainly, no hedge-padding.
- "pillars": 3-5 entries, each a distinct, specific reason for the stance, each grounded in a named metric, \
peer comparison, sentiment window, or detected signal from the evidence below. Each pillar has a "title" (a \
short label, 4-8 words) and "detail" (1-2 sentences, grounded, citing the specific evidence).
- "key_risks": 3-4 single-sentence risks TO THIS SPECIFIC STANCE (see instruction above for what that means) \
-- not generic company risk boilerplate.
- "catalysts_to_watch": 2-4 single-sentence near-term items relevant to this stance, drawn only from trends, \
signals, or sentiment windows already flagged in the evidence below -- not invented future events.

=== BASE / BULL / BEAR CASE ANALYSIS (already written, {ticker} vs. peers) ===
{case_blocks}

=== SENTIMENT BY TIME HORIZON ({ticker}) ===
{sentiment_block}

=== PEER SET ===
{peer_block}
"""


def _case_block(label: str, case: dict) -> str:
    lines = [f"## {label}", f"Stance: {case['stance']}"] + [f"- {p}" for p in case["points"]]
    return "\n".join(lines)


def _stance_instruction(stance: str | None) -> str:
    if not stance:
        return (
            "Decide the recommendation yourself: weigh how much concrete, high-reliability evidence backs "
            "the bull case vs. the bear case vs. the base case holding, and set \"recommendation\" to "
            "whichever the evidence actually favors. It is not a fresh independent opinion -- if the evidence "
            "is genuinely mixed, use \"Neutral\" rather than forcing a direction."
        )
    case_label = _STANCE_CASE_LABEL[stance]
    return (
        f"You have been specifically asked to build the case FOR a \"{stance}\" stance -- set "
        f"\"recommendation\" to exactly \"{stance}\", regardless of which case the evidence would otherwise "
        f"favor most. Ground your pillars primarily in the {case_label} case evidence below (the base case is "
        f"useful context, but the {case_label} case is your primary source) -- still strictly grounded, just "
        f"argued from that specific angle. \"key_risks\" here means risks TO THIS {stance.upper()} THESIS "
        f"SPECIFICALLY, i.e. what would have to happen to prove this view wrong: for a Bullish pitch that "
        f"means downside risks (draw on the bear case); for a Bearish pitch that means reasons the stock could "
        f"rally against you (draw on the bull case); for a Neutral pitch that means risks to staying on the "
        f"sidelines in either direction. \"catalysts_to_watch\" means events that would confirm or strengthen "
        f"this specific {stance} view."
    )


def generate_stock_pitch(ticker: str, stance: str | None = None, db: Database = None, refresh: bool = False) -> dict:
    """Reuses generate_investment_thesis() wholesale -- the same base/bull/
    bear cases and sentiment evidence the Bull / Bear Case tab shows -- as
    the grounded input for one more synthesis call, rather than re-deriving
    anything from raw metrics or news again.

    stance: None lets the model pick which case the evidence favors (the
    default "auto" pitch). Passing "Bullish"/"Neutral"/"Bearish" instead
    builds the pitch specifically arguing that case -- still grounded in the
    same evidence, just argued from that angle, the way a real desk would
    produce a long pitch and a short pitch off the same research.

    Cached per (ticker, stance) -- switching the stance toggle back and forth
    on the Investment Thesis page is then instant after the first view of
    each stance, and even a stance seen for the first time only pays for
    this function's own call (generate_investment_thesis below is not force-
    refreshed, so it's a cache hit whenever one exists). Pass refresh=True
    (the page's "Regenerate pitch" button) to force a new sample for the
    current stance without paying to rebuild the underlying evidence too."""
    from google import genai

    if stance is not None and stance not in STANCES:
        raise ValueError(f"stance must be one of {STANCES}, got {stance!r}")

    ticker = ticker.upper()
    cache_key = (ticker, stance or "auto")
    now = time.time()
    if not refresh:
        with _cache_lock:
            cached = _cache.get(cache_key)
            if cached and now - cached[0] < CACHE_TTL_SECONDS:
                return cached[1]

    db = db or Database()
    thesis = generate_investment_thesis(ticker, db=db)

    case_blocks = "\n\n".join(_case_block(label, thesis[key]) for key, label in CASE_LABELS)
    sentiment = thesis.get("sentiment", {})
    sentiment_block = "\n\n".join(
        f"## {WINDOW_LABELS[w]}\n{sentiment.get(w, 'n/a')}" for w in ("recent", "mid", "historical")
    )
    peer_block = "\n".join(f"- {p['ticker']} ({p['company_name']}): {p['reason']}" for p in thesis.get("peers", [])) \
        or "(no peers identified)"

    prompt = PROMPT.format(
        ticker=ticker, company_name=thesis["company_name"],
        peer_list=", ".join(p["ticker"] for p in thesis.get("peers", [])) or "(none)",
        stance_instruction=_stance_instruction(stance),
        case_blocks=case_blocks, sentiment_block=sentiment_block, peer_block=peer_block,
    )

    client = genai.Client(api_key=config.GOOGLE_API_KEY)
    response = client.models.generate_content(
        model=MODEL_NAME, contents=prompt,
        config={"response_mime_type": "application/json", "response_schema": StockPitch, "temperature": 0.3},
    )
    result = response.parsed.model_dump()
    result["ticker"] = ticker
    result["company_name"] = thesis["company_name"]
    result["peers"] = thesis["peers"]
    # Same three cases + sentiment evidence (with linked articles) already
    # computed above -- returned as-is so the page can show its receipts
    # (the Bull/Bear cases and news this pitch was built from) without a
    # second round of generation.
    result["base_case"] = thesis["base_case"]
    result["bull_case"] = thesis["bull_case"]
    result["bear_case"] = thesis["bear_case"]
    result["sentiment"] = sentiment
    with _cache_lock:
        _cache[cache_key] = (now, result)
    return result
