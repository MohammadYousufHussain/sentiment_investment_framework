# News Ingestion Architecture

## 1. Where this fits in the overall pipeline

The case study's Part 1 ("Market Sentiment & Opportunity Identification") is really
three distinct phases that happen to be described together. Keeping them separate is
what makes the system explainable and lets each phase be tested independently:

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐     ┌───────────────┐
│   Stage A     │     │   NLP Phase      │     │   Stage B     │     │  Time Series  │
│  ingestion    │ ──> │  NER + sentiment │ ──> │  ingestion    │ ──> │  & signal     │
│ (keyword-     │     │  on Stage A      │     │ (ticker-      │     │  detection    │
│  driven)      │     │  articles        │     │  scoped)      │     │               │
└──────────────┘     └──────────────────┘     └──────────────┘     └───────────────┘
      │                       │                       │                     │
      v                       v                       v                     v
  articles table      article_tickers +        articles table      daily sentiment
  (stage='A')         sentiment_scores         (stage='B')          per ticker, with
                       tables populated                             inflection/turn-
                                                                     around detectors
```

- **Stage A** is *user-triggered by a keyword/topic* (e.g. "renewable energy"), not a
  scan of a fixed ticker universe. It casts a wide net: whatever companies happen to
  be mentioned in the resulting articles are candidates.
- **The NLP phase** (built — see `architecture/name_entity_recognition.md`) reads the
  Stage A articles back out of the database and identifies which companies they
  mention via a spaCy+fuzzy / LLM ensemble against an SEC EDGAR reference table,
  surfacing a de-duped candidate ticker list the user reviews and prunes before
  Stage B runs. (This superseded the originally-sketched FinBERT/S&P-500/
  `article_tickers`+`sentiment_scores` design in the diagram below — the NER doc
  is the authoritative design for this phase; per-article sentiment scoring
  itself is not yet built.)
- **Stage B** (built — §8 below) is *ticker-driven*: for exactly the tickers the
  user kept selected from the NER candidate list, it pulls deeper, ticker-scoped
  news history to build a robust enough time series for signal detection.
- **Time series / signal detection** (not yet built) aggregates per-ticker daily
  sentiment and flags sharp inflections, sustained positivity, or negative→positive
  turnarounds — this is what actually produces the shortlist of 5 candidates.

**This document covers Stage A, Stage B, and the database.** NER/entity
identification is documented separately in `architecture/name_entity_recognition.md`.

## 2. Stage A source matrix

All four sources below were empirically tested (see `source_eval/`) before being
selected — this isn't a list from documentation, it's what was actually observed
working.

| Source | Query style | What it adds | Caveats found in testing |
|---|---|---|---|
| **Google News RSS** (direct, `feedparser`) | Free-text keyword | High volume (~100 entries/query), free, keyless | Same backend as the `gnews` pypi package — implemented directly instead of via that wrapper for control over parsing and rate-limiting |
| **NewsAPI** (`/v2/everything`) | Free-text keyword | Genuinely different outlet mix (CNN, BBC, The Verge, Fox, Gizmodo, Slashdot) than Google News RSS — real independent coverage, not a duplicate | Free/dev-tier key — note the ToS restricts the free tier to development/testing use, not production |
| **Alpha Vantage** (`NEWS_SENTIMENT`, `topics=`) | Fixed taxonomy (~15 categories: `earnings`, `mergers_and_acquisitions`, `energy_transportation`, `technology`, ...) | Every article comes back with a `ticker_sentiment` array — company/ticker tagging plus a provider-computed sentiment score, for free (as a byproduct of the API) | Not free-text — a keyword like "renewable energy" has to be mapped to the nearest fixed topic (`energy_transportation`). Premium key here allows 75 calls/min, so no meaningful budget constraint |
| **Yahoo Finance** (`yf.Search(query).news`) | Free-text keyword | Free, keyless, and each article includes a `relatedTickers` field — ticker tagging without any NER work | Lower volume (~10 results/query) than the other three |

GDELT DOC API was evaluated and **rejected** for this stack: naive queries returned
mostly non-English/non-US noise without careful `sourcelang`/`sourcecountry` filters,
per-article tone isn't available in the basic search endpoint (needs a separate
`timelinetone` call), and it rate-limited persistently even with 20s backoff between
retries — not reliable enough to depend on.

## 3. Data flow (Stage A, this build)

```
 user keyword ("renewable energy")
        │
        ├──> GoogleNewsRSSSource.fetch(keyword)  ──┐
        ├──> NewsAPISource.fetch(keyword)          │
        ├──> AlphaVantageSource.fetch(keyword)     ├──> normalize to Article ──> dedup on url_hash ──> SQLite: articles table
        └──> YahooSearchSource.fetch(keyword)      ┘                                                 (+ ingestion_runs log entry per source call)
```

Each source client implements a common interface (`fetch(query) -> list[Article]`),
so the orchestrator doesn't need to know source-specific details, and adding a fifth
source later is a matter of writing one new client class.

## 4. Database schema

SQLite was chosen over Postgres/DuckDB for this project: zero setup, a single
portable file, and fully sufficient for the data volumes here (thousands, not
billions, of articles). It is trivially queryable from pandas for the later scoring
and comps-analysis notebooks/scripts.

### `articles` (built now)

The central table. Holds raw ingested content from *both* Stage A and (later) Stage B
— distinguished by the `stage` column — so the NLP phase and the time-series phase
both read from one place regardless of which stage produced a given row.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `source` | TEXT | `google_news_rss` / `newsapi` / `alpha_vantage` / `yahoo_search` (Stage B sources added later) |
| `stage` | TEXT | `'A'` or `'B'` |
| `query_context` | TEXT | The keyword (Stage A) or ticker (Stage B) that produced this row — traceability back to why an article was fetched |
| `source_article_id` | TEXT, nullable | Native ID from the source, if any |
| `url` | TEXT | Original article URL |
| `url_hash` | TEXT, UNIQUE, indexed | SHA-256 of the normalized URL — the dedup key |
| `title` | TEXT | |
| `summary` | TEXT, nullable | |
| `author` | TEXT, nullable | |
| `published_at` | TEXT (ISO 8601, UTC), nullable | |
| `ingested_at` | TEXT (ISO 8601, UTC) | Defaults to insert time |
| `provider_sentiment_label` | TEXT, nullable | Only Alpha Vantage supplies this at present (`overall_sentiment_label`) |
| `provider_sentiment_score` | REAL, nullable | Same source; kept as a cross-check against our own FinBERT scoring in the NLP phase, not a substitute for it |
| `raw_payload` | TEXT (JSON) | The full original response for that article, kept verbatim so nothing is lost if we need a field we didn't think to normalize |

### `ingestion_runs` (built now)

One row per source call, for observability: what was run, how many articles came
back, how many were genuinely new after dedup, and whether it errored. This is what
makes the pipeline debuggable instead of a black box when a source misbehaves (as we
saw with GDELT's rate limiting and Benzinga's silently-ignored channel filter during
evaluation).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `source` | TEXT | |
| `stage` | TEXT | |
| `query` | TEXT | |
| `started_at` / `finished_at` | TEXT (ISO 8601) | |
| `status` | TEXT | `success` / `error` |
| `articles_fetched` | INTEGER | Raw count returned by the source |
| `articles_new` | INTEGER | Count actually inserted (post-dedup) |
| `error_message` | TEXT, nullable | |

### Deferred to the NLP-phase build (not created yet, by design)

- **`article_tickers`** — one row per (article, ticker mention), populated either from
  a source's native tagging (Alpha Vantage, Yahoo Search) or from NER + fuzzy-matching
  against the S&P 500 reference list for sources that don't tag tickers natively
  (Google News RSS, NewsAPI).
- **`sentiment_scores`** — one row per article holding our own FinBERT
  label/score, kept distinct from `provider_sentiment_*` on `articles` so the two can
  be compared rather than one silently overwriting the other.

Both will FK into `articles.id` — adding them later is a pure addition, not a
migration of existing data.

## 5. Deduplication

Articles are deduplicated on a SHA-256 hash of the normalized URL (`url_hash`,
`UNIQUE` + indexed). The same story frequently gets fetched from more than one source
(e.g. Google News RSS and NewsAPI both surfacing the same Reuters piece) or refetched
on a repeat run of the same keyword — the unique constraint plus `INSERT OR IGNORE`
makes re-running Stage A for the same keyword idempotent rather than accumulating
duplicate rows.

## 6. Rate limiting & resilience

Each source client owns its own minimum delay between requests, applied by the
orchestrator between calls:

| Source | Throttle | Reason |
|---|---|---|
| Google News RSS | ~1s | Politeness; no published limit but it's an unofficial-use endpoint |
| NewsAPI | ~1s | Free/dev-tier daily cap; no hard per-second limit documented |
| Alpha Vantage | ~1s (well under the 75/min premium ceiling) | Comfortable safety margin |
| Yahoo Finance (`yf.Search`) | ~1s | Politeness; unofficial API surface |

Each source client wraps its HTTP call in a small retry-with-backoff so a single
transient failure (timeout, 5xx, a 429) doesn't take down the whole run — it logs the
failure to `ingestion_runs` with `status='error'` and moves on to the next source
rather than crashing the pipeline for one keyword.

## 7. Configuration

- **Secrets** (`NEWSAPI_KEY`, `ALPHA_VANTAGE_API_KEY`, `BENZINGA_API_KEY`,
  `GOOGLE_API_KEY`) live in `.env`, loaded via `python-dotenv`, and are
  gitignored — never hardcoded or passed on the command line.
- **S&P 500 constituents** (`config/sp500_constituents.csv`) were fetched early
  on but superseded by SEC EDGAR's `company_tickers.json` for entity
  resolution — see `architecture/name_entity_recognition.md` §6 for why (Stage
  A surfaces names well outside the S&P 500).

## 8. Stage B: ticker-scoped deep ingestion

Runs for exactly the tickers a user keeps selected from the NER candidate list
(§1) — pulls a deeper, ticker-scoped news history for those specific companies
rather than the broad keyword sweep Stage A does.

### Source matrix

Reuses all four Stage A clients plus one ticker-only addition, rather than
building a parallel set of source integrations:

| Source | Query identifier | Why |
|---|---|---|
| **Google News RSS** | Company name (e.g. "Apple Inc.") | Free-text search — identical HTTP call to Stage A, just a company name instead of a topic keyword |
| **NewsAPI** | Company name | Same — no code difference from Stage A beyond the query string and `stage="B"` tag |
| **Alpha Vantage** | Ticker (`tickers=`) | A genuinely different API call from Stage A's `topics=` mode — `tickers=` is AV's native/primary mode (§ in NER doc), already gives per-ticker provider sentiment |
| **Yahoo Finance** | Ticker (`yf.Ticker(ticker).news`) | Different from Stage A's `yf.Search` — ticker-scoped, nested response structure (`item['content']['title']`, etc., vs. `yf.Search`'s flat one) |
| **Benzinga** | Ticker (`tickers=`) | New, Stage-B-only. Its `channels=` topic filter was found silently ignored on this plan during evaluation (see source_eval), so it was never viable for Stage A's topic-driven search — but ticker filtering works |

Because Google News RSS/NewsAPI need a company name while the other three need
a raw ticker, `run_stage_b_iter` (in `src/ingestion/pipeline.py`) takes both
`ticker` and `company_name` and routes each source to whichever it needs,
rather than assuming one identifier fits all five.

### Shared plumbing, not a parallel pipeline

Stage B is not a separate ingestion system — `_ingest_articles()` (insert +
dedup + full-text scrape + `ingestion_runs` logging) is the exact same
function Stage A uses, called with `stage="B"`. The `articles` table, the
`url_hash` dedup, and the full-text scraping module (including the Google
News redirect-resolution step) all apply unchanged. Verified live: re-running
Stage B for the same ticker shows `new=0` across all five sources.

### A real finding, not a bug: Benzinga's `tickers=` filter is primary-subject-scoped

Testing `run_stage_b` against TSLA and NVDA returned zero Benzinga articles
for both, which looked like a bug at first. Investigation: pulling Benzinga's
unfiltered feed directly found a TSLA-tagged article sitting right there
(`stocks: [{"name": "TSLA"}, {"name": "AAPL"}, ...]`) — genuinely present in
the data — yet `tickers=TSLA` still returned `[]`. AAPL, mentioned in that
same article, filters correctly. The pattern across several tickers (AAPL/MSFT
reliably return results; TSLA/NVDA didn't, at that moment) suggests Benzinga's
`tickers=` filter matches only when a ticker is the **primary** subject of
recent coverage, not merely mentioned/co-tagged — an undocumented behavior of
their API, not something fixable on our end. Practical effect: Benzinga
legitimately returns 0 for some tickers at some points in time; the other four
Stage B sources cover the gap when it happens, so no single source failure
blocks Stage B for a given company.

### What's not built yet

The webapp's "Proceed to Stage B" button currently only surfaces the selected
ticker list (see `CompanyEntitiesCard`) — wiring it to actually call
`run_stage_b` (mirroring how Stage A's SSE streaming search works) is the
natural next step, not yet done.
