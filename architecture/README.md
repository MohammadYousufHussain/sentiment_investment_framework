# Architecture Documentation

This folder documents the design of **Sentinel**, a sentiment-driven
investment research platform: news ingestion → company identification →
sentiment scoring → time-series signal detection → quantitative valuation →
integrated scoring → peer comparables → investment thesis generation, end
to end from raw articles to an AI-generated stock pitch.

Each doc covers one phase of the pipeline in the order data actually flows
through it. Every doc explains not just what was built but *why* — the
tradeoffs considered, the alternatives rejected, and (where it happened) the
bugs or design mistakes found along the way and how they were fixed. Most
docs close with a "Since this doc was written" or "What's not built yet"
section, kept honest and current rather than silently rewritten as the app
evolves out from under it.

## Pipeline docs, in data-flow order

1. **[`news_ingestion.md`](./news_ingestion.md)** — Data ingestion: Stage A
   (keyword-driven discovery across NewsAPI/Google News/Alpha Vantage), the
   NLP phase that sits between the two ingestion stages, and Stage B
   (ticker-driven deep collection). Source selection rationale, database
   schema, dedup/resilience/rate-limit handling, and deployment
   configuration (see also [`../DEPLOYMENT.md`](../DEPLOYMENT.md)).

2. **[`name_entity_recognition.md`](./name_entity_recognition.md)** —
   Turning free-text articles into ticker-tagged, relevance-classified
   mentions: the spaCy+fuzzy / Gemini LLM ensemble run against SEC EDGAR
   reference data, confidence tagging, and the manual company-search
   fallback.

3. **[`sentiment_analysis.md`](./sentiment_analysis.md)** — Per-article,
   per-ticker sentiment scoring: the FinBERT + Gemini LLM ensemble, how the
   two methods' outputs are actually combined (relevance-weighted LLM
   confidence, FinBERT as a cross-check), and the database schema for
   scored results.

4. **[`time_series_signals.md`](./time_series_signals.md)** — Aggregating
   per-article sentiment into Recent (0-3d) / Mid (4-14d) / Historical
   (15-30d) windows, why fixed windows were chosen over daily buckets (the
   data is heavily recency-skewed), the minimum-volume gate, and the three
   detected signal types (sharp inflection, sustained positivity/negativity,
   turnaround) with reliability tagging.

5. **[`integrated_scoring.md`](./integrated_scoring.md)** — **Scoring
   methodology.** How the self-relative (own-trailing-history) Value/
   Quality/Growth/Momentum z-scores are built, how the Sentiment factor is
   derived from the signal-detection windows above (and why its display
   score is a linear rescale, not a z-score CDF), the weighted-composite
   math, and the weight-locking/persistence mechanism shared across tabs.

6. **[`comparables.md`](./comparables.md)** — **Peer comps: how it
   generates.** The two-stage peer identification pipeline (sector rules +
   one LLM refinement call), how the side-by-side scorecard reuses
   Integrated Scoring's math verbatim, and the two-call (valuation +
   sentiment) AI rationale generation, grounded strictly in the metrics/
   articles on screen.

7. **[`investment_thesis.md`](./investment_thesis.md)** — **Investment
   thesis: how it generates.** Covers both the **Bull / Bear Case** page
   (Base/Bull/Bear case synthesis) and the **Investment Thesis** page (the
   stock pitch built on top of it) — the full multi-call generation chain,
   the grounding contract adopted after an earlier hallucination issue, the
   Bull/Neutral/Bear stance toggle and its risk-semantics inversion, and the
   two-layer caching that makes stance-switching fast.

## Deployment

**[`../DEPLOYMENT.md`](../DEPLOYMENT.md)** (repo root, not this folder) —
how the whole system above is packaged into one Docker container and
deployed to Railway: the single-worker and persistent-volume constraints
that shape the setup, environment variable configuration, and how to verify
data actually persists across a redeploy.
