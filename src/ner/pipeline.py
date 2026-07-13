from __future__ import annotations

import json
import logging

from ..db.database import Database
from . import benchmark, ensemble
from .llm_extractor import GeminiExtractor
from .reference_data import CompanyReference
from .spacy_fuzzy import SpacyFuzzyExtractor

logger = logging.getLogger(__name__)


def run_entity_extraction(query_context: str, db: Database = None,
                           spacy_extractor: SpacyFuzzyExtractor = None,
                           llm_extractor: GeminiExtractor = None) -> dict:
    """Runs NER (spaCy+fuzzy AND LLM, both -- see architecture doc §2) on every
    article for this query_context that hasn't been processed yet, stores raw
    per-method detections, and returns the per-search candidate ticker list
    plus a benchmark report against provider-native tags.

    Idempotent: articles already processed (by either method) are skipped, so
    re-running a search only pays for genuinely new articles."""
    db = db or Database()
    reference = CompanyReference()
    spacy_extractor = spacy_extractor or SpacyFuzzyExtractor(reference=reference)
    llm_extractor = llm_extractor or GeminiExtractor(reference=reference)

    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, source, full_text, summary, raw_payload FROM articles WHERE query_context = ?",
            (query_context,),
        ).fetchall()
        article_ids = [r["id"] for r in rows]
        missing = db.get_articles_missing_entities(conn, article_ids)
        to_process = [r for r in rows if r["id"] in missing]
        logger.info("entity extraction for %r: %d articles total, %d need processing",
                    query_context, len(rows), len(to_process))

        # spaCy + fuzzy -- fast, local, run inline per article.
        for row in to_process:
            text = row["full_text"] or row["summary"] or ""
            if not text:
                continue
            for mention in spacy_extractor.extract(text):
                db.insert_entity(conn, article_id=row["id"], method="spacy_fuzzy", **mention)
        conn.commit()

        # LLM -- batched across every article needing it, one call per batch.
        llm_input = [
            {"id": row["id"], "text": row["full_text"] or row["summary"] or ""}
            for row in to_process if (row["full_text"] or row["summary"])
        ]
        if llm_input:
            llm_results = llm_extractor.extract_many(llm_input, query=query_context)
            for article_id, mentions in llm_results.items():
                for mention in mentions:
                    db.insert_entity(conn, article_id=article_id, method="llm", **mention)

        for row in to_process:
            db.mark_entity_extraction_done(conn, row["id"])
        conn.commit()

        # Read back everything for this query (not just what was just
        # processed -- a repeat search should still return the full picture)
        # to build the rollup and benchmark.
        entity_rows = conn.execute(
            """
            SELECT ae.article_id, ae.ticker, ae.company_name, ae.method, ae.confidence,
                   ae.evidence_text, ae.relevance, ae.relevance_reason
            FROM article_entities ae
            JOIN articles a ON a.id = ae.article_id
            WHERE a.query_context = ?
            """,
            (query_context,),
        ).fetchall()

        by_article: dict[int, list[dict]] = {}
        for r in entity_rows:
            by_article.setdefault(r["article_id"], []).append(dict(r))

        candidates = ensemble.rollup_candidates(by_article)

        benchmark_reports = []
        for row in rows:
            if row["source"] not in benchmark.NATIVE_TAG_SOURCES:
                continue
            our_tickers = {e["ticker"] for e in by_article.get(row["id"], [])}
            raw = json.loads(row["raw_payload"]) if row["raw_payload"] else {}
            report = benchmark.compare_article(row["source"], raw, our_tickers)
            if report:
                benchmark_reports.append({"article_id": row["id"], **report})

    return {
        "candidates": candidates,
        "benchmark": benchmark_reports,
        "articles_total": len(rows),
        "articles_processed": len(to_process),
    }
