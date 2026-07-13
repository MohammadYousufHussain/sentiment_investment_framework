from __future__ import annotations

from pydantic import BaseModel

from .. import config
from ..db.database import Database
from ..sentiment.ensemble import LABEL_RANK, combine_article_sentiment
from . import aggregation

MODEL_NAME = "gemini-flash-lite-latest"

WINDOW_LABELS = {"recent": "Recent (0-3 days)", "mid": "Mid (4-14 days)", "historical": "Historical (15-30 days)"}


class SentimentRationale(BaseModel):
    recent: str
    mid: str
    historical: str


PROMPT = """You are an institutional equity analyst writing a brief news-driven sentiment rationale for \
{ticker}, one paragraph per time window below. For each window you're given {ticker}'s most bullish and \
most bearish scored article (if any), plus the single most notable article for any peer that has tracked \
news coverage in that window.

GROUNDING CONTRACT: your only source of fact is the articles listed below. You may know other real news \
about {ticker} or its peers from training -- other announcements, investments, launches, executive or \
regulatory news -- that simply isn't among the articles given here. DO NOT bring any of that in. Reference \
only the specific headline(s) given, and only the reasoning attached to each ("because: ..." is another \
analyst's own reasoning for that score -- use it, don't just restate the label, but don't extend it with \
outside context either).

Write 2-3 sentences per window, from {ticker}'s perspective, in the flat precise register of an \
institutional research note -- no promotional language, no invented catalysts. When a headline involves \
political commentary, statements by public figures, or other non-fundamental framing, describe the \
underlying business fact plainly (the investment, deal, or announcement itself) rather than repeating \
political or personality-driven language from the headline -- that framing belongs to the source article, \
not to your analysis of it. If a peer has a notably different or contrasting story in the same window, \
mention it briefly as worth watching -- but only if peer data is actually given below; never speculate about \
peers with no coverage shown. If {ticker} has no scored articles in a window, say so plainly in one sentence \
and stop there -- don't invent content to fill the paragraph.

{window_blocks}
"""


def _article_line(role: str, ticker: str, article: dict | None) -> str:
    if not article:
        return f"{ticker} {role}: none"
    return (
        f"{ticker} {role}: \"{article['title']}\" ({article['source']}, {article['published_at']}) -- "
        f"{article['label']}, because: {article['reasoning']}"
    )


def _top_articles_for_ticker(ticker: str, db: Database) -> dict:
    """Per window: the most bullish and most bearish scored article for this
    ticker, with the LLM's own one-sentence reasoning already attached (see
    src/sentiment/llm_sentiment.py) -- reused as evidence here rather than
    re-reading full article text a second time. Incidental-relevance articles
    are excluded (relevance_weight 0) -- they shouldn't be cited as "this
    ticker's news" any more than they count toward its aggregate sentiment."""
    with db.connect() as conn:
        articles = conn.execute(
            "SELECT id, title, published_at, source, url FROM articles WHERE stage = 'B' AND query_context = ?",
            (ticker,),
        ).fetchall()
        sentiment_rows = conn.execute(
            "SELECT * FROM article_sentiment WHERE ticker = ?", (ticker,)
        ).fetchall()

    by_article: dict[int, list[dict]] = {}
    for r in sentiment_rows:
        by_article.setdefault(r["article_id"], []).append(dict(r))
    meta_by_id = {a["id"]: dict(a) for a in articles}

    scored = []
    for article_id, rows in by_article.items():
        combined = combine_article_sentiment(rows)
        meta = meta_by_id.get(article_id)
        if not combined or not meta or not meta.get("published_at") or combined["relevance_weight"] <= 0:
            continue
        scored.append({
            "title": meta["title"], "source": meta["source"], "published_at": meta["published_at"],
            "url": meta["url"], "rank": LABEL_RANK[combined["label"]], "label": combined["label"],
            "confidence": combined["confidence"], "reasoning": combined["llm"]["reasoning"],
        })

    buckets = aggregation.bucket_articles(scored)
    result = {}
    for window in aggregation.WINDOWS:
        window_name = window[0]
        window_articles = buckets.get(window_name, [])
        if not window_articles:
            result[window_name] = {"bullish": None, "bearish": None}
            continue
        bullish = max(window_articles, key=lambda a: (a["rank"], a["confidence"]))
        bearish = min(window_articles, key=lambda a: (a["rank"], -a["confidence"]))
        result[window_name] = {"bullish": bullish, "bearish": bearish if bearish is not bullish else None}
    return result


def _window_block(window: str, ticker: str, target_top: dict, peer_tickers: list[str], peers_top: dict) -> str:
    t = target_top[window]
    lines = [
        f"## {WINDOW_LABELS[window]}",
        _article_line("most bullish", ticker, t["bullish"]),
        _article_line("most bearish", ticker, t["bearish"]),
    ]
    for peer in peer_tickers:
        p = peers_top.get(peer, {}).get(window, {})
        candidates = [a for a in (p.get("bullish"), p.get("bearish")) if a]
        if not candidates:
            continue
        notable = max(candidates, key=lambda a: abs(a["rank"]))
        lines.append(_article_line("notable peer story", peer, notable))
    return "\n".join(lines)


def generate_sentiment_rationale(ticker: str, peer_tickers: list[str], db: Database = None) -> dict:
    """Pure read over article_sentiment + articles (same tables signals/pipeline.py
    reads, at article granularity instead of aggregated) -- no new storage,
    no re-scoring. Most peers won't have any ingested coverage; that window
    just reports "none" for them rather than failing."""
    from google import genai

    db = db or Database()
    target_top = _top_articles_for_ticker(ticker, db)
    peers_top = {p: _top_articles_for_ticker(p, db) for p in peer_tickers}

    window_blocks = "\n\n".join(
        _window_block(w[0], ticker, target_top, peer_tickers, peers_top) for w in aggregation.WINDOWS
    )
    prompt = PROMPT.format(ticker=ticker, window_blocks=window_blocks)

    client = genai.Client(api_key=config.GOOGLE_API_KEY)
    response = client.models.generate_content(
        model=MODEL_NAME, contents=prompt,
        config={"response_mime_type": "application/json", "response_schema": SentimentRationale, "temperature": 0.3},
    )
    result = response.parsed.model_dump()
    # The narrated paragraphs above are prose built FROM these same articles --
    # attached here too, unmodified, so a caller (Investment Thesis) can link
    # straight to the specific headline behind each window's read rather than
    # only showing the LLM's summary of it.
    result["articles"] = target_top
    return result
