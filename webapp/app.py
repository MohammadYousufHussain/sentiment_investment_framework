#!/usr/bin/env python3
"""API + static server for the Stage A news ingestion console.

The frontend is a React/Vite/Tailwind SPA built to webapp/dist/ (see
webapp/frontend/). This file is a pure JSON/SSE API plus a static file server
for that built bundle -- no server-rendered HTML.

Run with:
    python3 webapp/app.py
Then open http://127.0.0.1:5000

If you're actively changing the frontend, run the Vite dev server instead
(cd webapp/frontend && npm run dev) -- it proxies /api to this Flask process
(see frontend/vite.config.js) and gives you hot reload.
"""
import json
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context

from src.db.database import Database
from src.ingestion.pipeline import STAGE_A_SOURCES, run_stage_a_iter, run_stage_b_iter
from src.ner.pipeline import run_entity_extraction

DIST_DIR = Path(__file__).parent / "dist"

app = Flask(__name__, static_folder=None)
db = Database()

# Stage B can take minutes across several tickers, and the user should be
# able to navigate away from whatever page started it and check back later --
# so it runs in a background thread with status tracked in memory (this is a
# single-process dev server; a DB-backed job table would be the production
# equivalent) rather than a page-scoped SSE stream that dies on navigation.
_stage_b_lock = threading.Lock()
_stage_b_jobs = {}  # ticker -> {company_name, status, sources: {name: {...}}, started_at, finished_at}


def _run_stage_b_background(items):
    """items: [(ticker, company_name), ...]. Processed sequentially, not in
    parallel, so concurrent tickers don't contend for the same rate-limited
    API keys (Alpha Vantage, Benzinga) at once."""
    for ticker, company_name in items:
        with _stage_b_lock:
            _stage_b_jobs[ticker] = {
                "company_name": company_name, "status": "running",
                "sources": {}, "started_at": None, "finished_at": None,
            }
        try:
            for result in run_stage_b_iter(ticker, company_name, db=db):
                source = result.pop("source")
                result.pop("articles", None)
                with _stage_b_lock:
                    _stage_b_jobs[ticker]["sources"][source] = result
            with _stage_b_lock:
                _stage_b_jobs[ticker]["status"] = "done"
        except Exception as exc:
            with _stage_b_lock:
                _stage_b_jobs[ticker]["status"] = "error"
                _stage_b_jobs[ticker]["error"] = str(exc)

# Shared across NER and the company-search box below -- the SEC EDGAR index
# alone is cheap to build (just a JSON load + fuzzy index), but there's no
# reason to build it twice when both features want the same reference data.
_company_reference_lock = threading.Lock()
_company_reference_singleton = {}


def get_company_reference():
    with _company_reference_lock:
        if "ref" not in _company_reference_singleton:
            from src.ner.reference_data import CompanyReference

            _company_reference_singleton["ref"] = CompanyReference()
        return _company_reference_singleton["ref"]


# The spaCy transformer model and Gemini client are expensive to construct
# (model load alone is ~1-4s) -- lazy-loaded once on first /api/entities call
# and reused for every request after, rather than rebuilt per-request.
_ner_lock = threading.Lock()
_ner_singletons = {}


def get_ner_extractors():
    with _ner_lock:
        if "spacy" not in _ner_singletons:
            from src.ner.llm_extractor import GeminiExtractor
            from src.ner.spacy_fuzzy import SpacyFuzzyExtractor

            reference = get_company_reference()
            _ner_singletons["spacy"] = SpacyFuzzyExtractor(reference=reference)
            _ner_singletons["llm"] = GeminiExtractor(reference=reference)
        return _ner_singletons["spacy"], _ner_singletons["llm"]


# Same lazy-singleton pattern as NER -- FinBERT's model load is expensive
# enough to avoid repeating per-request.
_sentiment_lock = threading.Lock()
_sentiment_singletons = {}


def get_sentiment_analyzers():
    with _sentiment_lock:
        if "finbert" not in _sentiment_singletons:
            from src.sentiment.finbert_analyzer import FinBertAnalyzer
            from src.sentiment.llm_sentiment import LLMSentimentAnalyzer

            _sentiment_singletons["finbert"] = FinBertAnalyzer()
            _sentiment_singletons["llm"] = LLMSentimentAnalyzer()
        return _sentiment_singletons["finbert"], _sentiment_singletons["llm"]


def _lookup_company_name(conn, ticker):
    row = conn.execute("SELECT company_name FROM article_entities WHERE ticker = ? LIMIT 1", (ticker,)).fetchone()
    return row["company_name"] if row else ticker


AGE_BUCKETS = [(3, "0-3d"), (7, "4-7d"), (14, "8-14d"), (30, "15-30d")]


def compute_age_histogram(published_ats: list) -> dict:
    """Buckets articles by age from now, so the UI can show how front-loaded
    (vs. genuinely historical) a ticker's coverage is -- directly informs how
    much signal a daily time series would actually have per bucket."""
    now = datetime.now(timezone.utc)
    counts = {label: 0 for _, label in AGE_BUCKETS}
    counts["30d+"] = 0

    for raw in published_ats:
        if not raw:
            continue
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        age_days = (now - dt).total_seconds() / 86400

        for max_days, label in AGE_BUCKETS:
            if age_days <= max_days:
                counts[label] += 1
                break
        else:
            counts["30d+"] += 1

    return counts


@app.route("/api/filters")
def api_filters():
    with db.connect() as conn:
        sources = [r["source"] for r in conn.execute("SELECT DISTINCT source FROM articles ORDER BY source")]
        queries = [r["query_context"] for r in conn.execute("SELECT DISTINCT query_context FROM articles ORDER BY query_context")]
        total = conn.execute("SELECT COUNT(*) c FROM articles").fetchone()["c"]
        counts_by_source = {
            r["source"]: r["c"]
            for r in conn.execute("SELECT source, COUNT(*) c FROM articles GROUP BY source")
        }
    return jsonify({"sources": sources, "queries": queries, "total": total, "counts_by_source": counts_by_source})


@app.route("/api/articles")
def api_articles():
    source_filter = request.args.get("source", "").strip()
    query_filter = request.args.get("query", "").strip()
    limit = min(int(request.args.get("limit", 30) or 30), 200)

    sql = "SELECT * FROM articles WHERE 1=1"
    params = []
    if source_filter:
        sql += " AND source = ?"
        params.append(source_filter)
    if query_filter:
        sql += " AND query_context = ?"
        params.append(query_filter)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)

    with db.connect() as conn:
        articles = [dict(r) for r in conn.execute(sql, params)]

    for a in articles:
        a["summary_len"] = len(a["summary"]) if a.get("summary") else 0
        a["full_text_len"] = len(a["full_text"]) if a.get("full_text") else 0
        a.pop("raw_payload", None)

    return jsonify({"articles": articles})


@app.route("/api/entities")
def api_entities():
    query = request.args.get("query", "").strip()
    if not query:
        return jsonify({"error": "query parameter required"}), 400

    spacy_extractor, llm_extractor = get_ner_extractors()
    result = run_entity_extraction(query, db=db, spacy_extractor=spacy_extractor, llm_extractor=llm_extractor)
    return jsonify(result)


@app.route("/api/company-search")
def api_company_search():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"results": []})

    reference = get_company_reference()
    results = reference.search(query)
    return jsonify({"results": [{"ticker": e.ticker, "company_name": e.company_name} for e in results]})


@app.route("/api/stage-b/trigger", methods=["POST"])
def api_stage_b_trigger():
    payload = request.get_json(force=True) or {}
    tickers = payload.get("tickers", [])
    items = [(t["ticker"], t["company_name"]) for t in tickers if t.get("ticker")]
    if not items:
        return jsonify({"error": "tickers required"}), 400

    threading.Thread(target=_run_stage_b_background, args=(items,), daemon=True).start()
    return jsonify({"started": [t for t, _ in items]})


@app.route("/api/stage-b/status")
def api_stage_b_status():
    with _stage_b_lock:
        return jsonify(dict(_stage_b_jobs))


@app.route("/api/companies")
def api_companies():
    with db.connect() as conn:
        rows = conn.execute("""
            SELECT query_context AS ticker, COUNT(*) AS article_count,
                   MIN(published_at) AS earliest, MAX(published_at) AS latest
            FROM articles WHERE stage = 'B' GROUP BY query_context
        """).fetchall()

        companies = []
        for r in rows:
            ticker = r["ticker"]
            name_row = conn.execute(
                "SELECT company_name FROM article_entities WHERE ticker = ? LIMIT 1", (ticker,)
            ).fetchone()
            themes = [t["query_context"] for t in conn.execute("""
                SELECT DISTINCT a.query_context FROM article_entities ae
                JOIN articles a ON a.id = ae.article_id
                WHERE ae.ticker = ? AND a.stage = 'A'
            """, (ticker,))]
            companies.append({
                "ticker": ticker,
                "company_name": name_row["company_name"] if name_row else ticker,
                "article_count": r["article_count"],
                "earliest": r["earliest"],
                "latest": r["latest"],
                "themes": themes,
            })

    return jsonify({"companies": companies})


@app.route("/api/companies/<ticker>")
def api_company_detail(ticker):
    with db.connect() as conn:
        articles = [dict(r) for r in conn.execute(
            "SELECT * FROM articles WHERE stage = 'B' AND query_context = ? ORDER BY published_at DESC",
            (ticker,),
        )]
        company_name = _lookup_company_name(conn, ticker)
        themes = [t["query_context"] for t in conn.execute("""
            SELECT DISTINCT a.query_context FROM article_entities ae
            JOIN articles a ON a.id = ae.article_id
            WHERE ae.ticker = ? AND a.stage = 'A'
        """, (ticker,))]
        source_counts = {
            r["source"]: r["c"] for r in conn.execute(
                "SELECT source, COUNT(*) c FROM articles WHERE stage='B' AND query_context=? GROUP BY source",
                (ticker,),
            )
        }
        # The most recent persisted ingestion_runs row per source -- this is
        # what lets the dashboard tell "ran and genuinely found 0 articles"
        # (e.g. Benzinga's tickers= filter often returns nothing for a given
        # name) apart from "never attempted", since in-memory job status
        # (_stage_b_jobs) is lost on every dev-server restart.
        source_runs = {
            r["source"]: {"status": r["status"], "fetched": r["articles_fetched"],
                           "new": r["articles_new"], "finished_at": r["finished_at"],
                           "error": r["error_message"]}
            for r in conn.execute("""
                SELECT source, status, articles_fetched, articles_new, finished_at, error_message
                FROM ingestion_runs ir
                WHERE stage='B' AND query=?
                AND id = (SELECT MAX(id) FROM ingestion_runs WHERE source=ir.source AND stage='B' AND query=ir.query)
            """, (ticker,))
        }

    for a in articles:
        a["summary_len"] = len(a["summary"]) if a.get("summary") else 0
        a["full_text_len"] = len(a["full_text"]) if a.get("full_text") else 0
        a.pop("raw_payload", None)

    if not articles and company_name == ticker:
        return jsonify({"error": "no data for this ticker"}), 404

    age_histogram = compute_age_histogram([a["published_at"] for a in articles])
    dates = [a["published_at"] for a in articles if a["published_at"]]

    return jsonify({
        "ticker": ticker,
        "company_name": company_name,
        "themes": themes,
        "source_counts": source_counts,
        "source_runs": source_runs,
        "articles": articles,
        "age_histogram": age_histogram,
        "earliest": min(dates) if dates else None,
        "latest": max(dates) if dates else None,
    })


@app.route("/api/companies/<ticker>/sentiment")
def api_company_sentiment(ticker):
    from src.sentiment.pipeline import run_sentiment_analysis

    with db.connect() as conn:
        company_name = _lookup_company_name(conn, ticker)

    finbert_analyzer, llm_analyzer = get_sentiment_analyzers()
    result = run_sentiment_analysis(ticker, company_name, db=db,
                                     finbert_analyzer=finbert_analyzer, llm_analyzer=llm_analyzer)
    return jsonify(result)


@app.route("/api/companies/<ticker>/sentiment-stream")
def api_company_sentiment_stream(ticker):
    """Same work as /sentiment, but streamed via SSE -- FinBERT + LLM scoring
    can take up to a minute, and the client can show real progress instead of
    a silent blocking wait (see run_sentiment_analysis_iter)."""
    from src.sentiment.pipeline import run_sentiment_analysis_iter

    with db.connect() as conn:
        company_name = _lookup_company_name(conn, ticker)

    finbert_analyzer, llm_analyzer = get_sentiment_analyzers()

    def event(payload: dict) -> str:
        return f"data: {json.dumps(payload, default=str)}\n\n"

    def generate():
        for item in run_sentiment_analysis_iter(ticker, company_name, db=db,
                                                  finbert_analyzer=finbert_analyzer, llm_analyzer=llm_analyzer):
            yield event(item)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/companies/<ticker>/valuation")
def api_company_valuation(ticker):
    from src.valuation.pipeline import get_valuation

    period = request.args.get("period", "annual")
    try:
        result = get_valuation(ticker, period=period)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    return jsonify(result)


@app.route("/api/companies/<ticker>/qis-factors")
def api_company_qis_factors(ticker):
    from src.valuation.qis_factors import build_factor_scorecard

    try:
        result = build_factor_scorecard(ticker)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    return jsonify(result)


@app.route("/api/companies/<ticker>/historical-factors")
def api_company_historical_factors(ticker):
    from src.valuation.historical_factors import build_historical_scorecard

    try:
        result = build_historical_scorecard(ticker)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    return jsonify(result)


@app.route("/api/companies/<ticker>/peers")
def api_company_peers(ticker):
    from src.valuation.peer_selection import suggest_peers

    refresh = request.args.get("refresh") == "true"
    try:
        result = suggest_peers(ticker, refresh=refresh)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    return jsonify(result)


@app.route("/api/companies/<ticker>/signals")
def api_company_signals(ticker):
    from src.signals.pipeline import analyze_signals
    return jsonify(analyze_signals(ticker, db=db))


@app.route("/api/companies/<ticker>/investment-thesis")
def api_investment_thesis(ticker):
    from src.valuation.thesis import generate_investment_thesis

    refresh = request.args.get("refresh") == "true"
    try:
        result = generate_investment_thesis(ticker, db=db, refresh=refresh)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    return jsonify(result)


@app.route("/api/companies/<ticker>/stock-pitch")
def api_stock_pitch(ticker):
    from src.valuation.pitch import STANCES, generate_stock_pitch

    stance = request.args.get("stance") or None
    if stance is not None and stance not in STANCES:
        return jsonify({"error": f"stance must be one of {STANCES}"}), 400
    refresh = request.args.get("refresh") == "true"

    try:
        result = generate_stock_pitch(ticker, stance=stance, db=db, refresh=refresh)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    return jsonify(result)


@app.route("/api/companies/<ticker>/comparables-rationale", methods=["POST"])
def api_comparables_rationale(ticker):
    """Two independent LLM calls run concurrently -- valuation (numeric
    metric comparison) and sentiment (news-article comparison) are different
    enough tasks that bundling them into one call would dilute both; see
    src/valuation/rationale.py and src/signals/rationale.py for why each is
    its own single call rather than one-per-factor."""
    from concurrent.futures import ThreadPoolExecutor

    from src.signals.rationale import generate_sentiment_rationale
    from src.valuation.rationale import generate_valuation_rationale

    peers = [p.upper() for p in (request.get_json(silent=True) or {}).get("peers", []) if p]

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            valuation_future = pool.submit(generate_valuation_rationale, ticker, peers)
            sentiment_future = pool.submit(generate_sentiment_rationale, ticker, peers, db)
            result = {"valuation": valuation_future.result(), "sentiment": sentiment_future.result()}
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    return jsonify(result)


@app.route("/api/search-stream")
def search_stream():
    query = request.args.get("q", "").strip()
    max_results = int(request.args.get("max_results", 20))

    if not query:
        return Response("data: " + json.dumps({"type": "error", "message": "empty query"}) + "\n\n",
                         mimetype="text/event-stream")

    def event(payload: dict) -> str:
        return f"data: {json.dumps(payload, default=str)}\n\n"

    def generate():
        totals = {"fetched": 0, "new": 0}
        source_names = [s.name for s in STAGE_A_SOURCES]
        yield event({"type": "sources", "sources": source_names, "query": query})

        for result in run_stage_a_iter(query, max_results=max_results):
            totals["fetched"] += result.get("fetched", 0)
            totals["new"] += result.get("new", 0)
            result["articles"] = [{k: v for k, v in a.items() if k != "raw_payload"} for a in result.get("articles", [])]
            yield event({"type": "source_done", **result})

        yield event({"type": "complete", "query": query, **totals})

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def spa(path):
    """Serve the built React app, falling back to index.html for client-side
    routes (e.g. /browse) so a hard refresh on those URLs works."""
    full_path = DIST_DIR / path
    if path and full_path.is_file():
        return send_from_directory(DIST_DIR, path)
    return send_from_directory(DIST_DIR, "index.html")


if __name__ == "__main__":
    if not (DIST_DIR / "index.html").exists():
        print(f"No build found at {DIST_DIR}. Run: cd webapp/frontend && npm run build")
    app.run(debug=True, threaded=True, port=5000)
