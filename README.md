# Sentinel

A sentiment-driven investment research platform. Ingests financial news,
identifies which companies each article is actually about, scores sentiment
per article and per ticker, aggregates it into time-windowed signals,
combines it with a self-relative quantitative valuation scorecard, and
generates AI-written peer comparisons and investment theses — grounded
strictly in the data actually collected, not the model's pretrained
knowledge of the company.

One Flask process serves both the JSON/SSE API and a pre-built React SPA;
one SQLite database holds everything.

## Pipeline

```
News ingestion (Stage A: keyword discovery, Stage B: ticker-scoped deep collection)
        │
        v
Company identification (NER: spaCy+fuzzy / Gemini LLM ensemble vs. SEC EDGAR)
        │
        v
Sentiment scoring (FinBERT + Gemini LLM ensemble, per article per ticker)
        │
        v
Time-series signal detection (Recent/Mid/Historical windows, trend signals)
        │
        v
Quantitative valuation (self-relative Value/Quality/Growth/Momentum z-scores)
        │
        v
Integrated Scoring  →  Comparables (peer AI rationale)  →  Investment Thesis (AI stock pitch)
```

Every stage is documented in depth, including the design decisions and
tradeoffs behind it, in **[`architecture/`](./architecture/README.md)** —
start there for how any specific piece actually works.

## Quick start (local)

**Requirements:** Python 3.11+, Node 20+, and four API keys (a Gemini key
from Google AI Studio, and free-tier keys from NewsAPI, Alpha Vantage, and
Benzinga).

```bash
# 1. Configure secrets
cp .env.example .env
# edit .env and fill in: NEWSAPI_KEY, ALPHA_VANTAGE_API_KEY,
# BENZINGA_API_KEY, GOOGLE_API_KEY

# 2. Python deps
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m spacy download en_core_web_trf

# 3. Frontend build (produces webapp/dist/, served by Flask)
cd webapp/frontend && npm install && npm run build && cd ../..

# 4. Run
python3 webapp/app.py
# open http://127.0.0.1:5000
```

The database schema is created automatically on first run — no manual init
step (`src/db/database.py`). Actively changing the frontend? Run the Vite
dev server instead of the build step: `cd webapp/frontend && npm run dev`
— it proxies `/api` to the Flask process (`webapp/frontend/vite.config.js`)
and gives you hot reload.

Data is ingested per-ticker from the Companies page (Stage B), or
discovered by keyword from the Search page (Stage A) — the app starts fully
functional with an empty database, nothing pre-loaded.

## Deploying

Packaged as one Docker container; **[`DEPLOYMENT.md`](./DEPLOYMENT.md)**
covers deploying it to Railway, including the two constraints that shape
the setup (single-worker process, SQLite needs a persistent volume) and how
to verify data actually survives a redeploy.

## Repository layout

```
src/
  ingestion/    Stage A/B news collection, source clients, dedup
  ner/          Company/ticker identification from article text
  sentiment/    FinBERT + LLM ensemble sentiment scoring
  signals/      Time-windowed sentiment aggregation, trend/signal detection,
                and the AI rationale generators (valuation + sentiment)
  valuation/    Self-relative factor scorecard, peer selection, Integrated
                Scoring math inputs, Bull/Bear Case + stock pitch generation
  db/           SQLite schema and access layer
webapp/
  app.py        Flask API + static server
  frontend/     React/Vite/Tailwind SPA (source; builds to webapp/dist/)
scripts/        One-off/maintenance CLI scripts (init_db, backfill, etc.)
config/         Static reference data (SEC ticker list, S&P 500 constituents)
architecture/   Design docs, one per pipeline phase — see architecture/README.md
```

## Documentation

- **[`architecture/README.md`](./architecture/README.md)** — index of all
  design docs, in pipeline order: news ingestion, NER, sentiment analysis,
  time-series signals, integrated scoring methodology, comparables, and
  investment thesis generation.
- **[`DEPLOYMENT.md`](./DEPLOYMENT.md)** — Docker/Railway deployment guide.
