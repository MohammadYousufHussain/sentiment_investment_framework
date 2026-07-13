from __future__ import annotations

import json
import logging

from ..db.database import Database
from . import benchmark, ensemble
from .finbert_analyzer import FinBertAnalyzer
from .llm_sentiment import LLMSentimentAnalyzer

logger = logging.getLogger(__name__)


def _mentions_company(text: str, ticker: str, company_name: str) -> bool:
    """Alpha Vantage's ticker_sentiment tags articles more broadly than the
    scraped text supports -- some tagged articles never mention the company
    or ticker anywhere in their text (e.g. broad "Russell index reconstitution"
    roundups). Sending those to the LLM wastes a call and it can't ground a
    result anyway, so they're filtered out before the batch call rather than
    retried forever."""
    text_lower = text.lower()
    if ticker.lower() in text_lower:
        return True
    core_name = company_name.split(",")[0]
    for suffix in (" Inc.", " Inc", " Corp.", " Corp", " Corporation", " Ltd.", " Ltd"):
        if core_name.endswith(suffix):
            core_name = core_name[: -len(suffix)]
            break
    return core_name.lower() in text_lower


def run_sentiment_analysis_iter(ticker: str, company_name: str, db: Database = None,
                                 finbert_analyzer: FinBertAnalyzer = None,
                                 llm_analyzer: LLMSentimentAnalyzer = None):
    """Generator version of run_sentiment_analysis -- yields {"type": "progress",
    phase, processed, total} as it works through FinBERT then the LLM batches,
    then a final {"type": "complete", ...} with the same fields
    run_sentiment_analysis returns, so a caller can stream progress to a
    client (see /api/companies/<ticker>/sentiment-stream) instead of blocking
    silently for up to a minute."""
    db = db or Database()
    finbert_analyzer = finbert_analyzer or FinBertAnalyzer()
    llm_analyzer = llm_analyzer or LLMSentimentAnalyzer()

    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, source, full_text, summary, raw_payload FROM articles WHERE stage = 'B' AND query_context = ?",
            (ticker,),
        ).fetchall()
        article_ids = [r["id"] for r in rows]
        missing = db.get_articles_missing_sentiment(conn, article_ids)
        to_process = [r for r in rows if r["id"] in missing]
        logger.info("sentiment analysis for %r: %d articles total, %d need processing",
                    ticker, len(rows), len(to_process))

        # FinBERT -- fast, local, run inline per article.
        finbert_total = len(to_process)
        yield {"type": "progress", "phase": "finbert", "processed": 0, "total": finbert_total}
        for i, row in enumerate(to_process, start=1):
            text = row["full_text"] or row["summary"] or ""
            if text:
                result = finbert_analyzer.analyze(text, ticker, company_name)
                if result:
                    db.insert_sentiment(conn, article_id=row["id"], ticker=ticker, method="finbert", **result)
            if i % 5 == 0 or i == finbert_total:
                yield {"type": "progress", "phase": "finbert", "processed": i, "total": finbert_total}
        conn.commit()

        # LLM -- batched across every article needing it. Skip articles whose
        # text doesn't even mention the company (tagged by source metadata
        # only) -- the LLM can't ground a result for those anyway.
        llm_input = [
            {"id": row["id"], "text": row["full_text"] or row["summary"] or ""}
            for row in to_process
            if (row["full_text"] or row["summary"])
            and _mentions_company(row["full_text"] or row["summary"] or "", ticker, company_name)
        ]
        llm_results = {}
        if llm_input:
            yield {"type": "progress", "phase": "llm", "processed": 0, "total": len(llm_input)}
            for kind, *payload in llm_analyzer.analyze_many_iter(llm_input, ticker, company_name):
                if kind == "progress":
                    processed, total = payload
                    yield {"type": "progress", "phase": "llm", "processed": processed, "total": total}
                else:
                    llm_results = payload[0]
            for article_id, result in llm_results.items():
                db.insert_sentiment(conn, article_id=article_id, ticker=ticker, method="llm", **result)

        # A batch call can silently omit an id from its response (model
        # non-compliance, not an exception) -- don't mark those done, so
        # they're retried on the next run instead of being lost forever.
        expected_llm_ids = {item["id"] for item in llm_input}
        for row in to_process:
            if row["id"] in expected_llm_ids and row["id"] not in llm_results:
                continue
            db.mark_sentiment_done(conn, row["id"])
        conn.commit()

        # Read back everything for this ticker (not just what was just
        # processed) to build the rollup and benchmark.
        sentiment_rows = conn.execute(
            "SELECT * FROM article_sentiment WHERE ticker = ?", (ticker,)
        ).fetchall()
        by_article: dict[int, list[dict]] = {}
        for r in sentiment_rows:
            by_article.setdefault(r["article_id"], []).append(dict(r))

        article_results = {aid: ensemble.combine_article_sentiment(v) for aid, v in by_article.items()}
        summary = ensemble.summarize_ticker_sentiment(list(article_results.values()))

        benchmark_reports = []
        for row in rows:
            if row["source"] != "alpha_vantage":
                continue
            combined = article_results.get(row["id"])
            if not combined:
                continue
            raw = json.loads(row["raw_payload"]) if row["raw_payload"] else {}
            report = benchmark.compare_article(row["source"], raw, ticker, combined["label"])
            if report:
                benchmark_reports.append({"article_id": row["id"], **report})

    yield {
        "type": "complete",
        "ticker": ticker,
        "summary": summary,
        "benchmark": benchmark_reports,
        "articles_total": len(rows),
        "articles_processed": len(to_process),
        "article_results": article_results,
    }


def run_sentiment_analysis(ticker: str, company_name: str, db: Database = None,
                            finbert_analyzer: FinBertAnalyzer = None,
                            llm_analyzer: LLMSentimentAnalyzer = None) -> dict:
    """Runs both sentiment methods (FinBERT-on-snippets + LLM) on every Stage B
    article for this ticker that hasn't been scored yet, stores raw per-method
    results, and returns a per-ticker summary plus a benchmark against
    Alpha Vantage's native ticker_sentiment.

    Idempotent, same pattern as NER's run_entity_extraction: articles already
    scored (by either method) are skipped via article_sentiment_runs.

    Blocking wrapper around run_sentiment_analysis_iter for callers that don't
    need progress (e.g. one-off scripts) -- discards the progress events."""
    for event in run_sentiment_analysis_iter(ticker, company_name, db=db,
                                              finbert_analyzer=finbert_analyzer, llm_analyzer=llm_analyzer):
        if event["type"] == "complete":
            return {k: v for k, v in event.items() if k != "type"}
