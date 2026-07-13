# Named-Entity Recognition: Company Identification

## 1. Where this fits in the pipeline

This is the phase that sits between Stage A and Stage B, and it's user-facing, not
a background batch job:

```
Stage A (keyword search, already built)
        │
        v
Entity extraction runs automatically on every article from that search
        │
        v
De-duped candidate ticker list surfaces in the UI
(company name, ticker, mention count, confidence, which method(s) found it)
        │
        v
User reviews the list, deselects tickers they don't want to pursue
        │
        v
Stage B runs only for the tickers the user kept selected
(Benzinga + Alpha Vantage tickers= + Yahoo ticker.news)
```

Because the candidate list is what the user acts on, the extraction has to
finish inline with a single search, not overnight in a batch script — that
shapes several decisions below (batching the LLM calls, running spaCy+fuzzy
first since it's fast, etc).

## 2. Core design decision: custom NER on every article, native tags as benchmark only

Two of the four Stage A sources (Alpha Vantage, Yahoo Search) already tag
articles with tickers natively. The obvious shortcut would be to trust those
tags and only run NER on the two sources that don't have them (Google News RSS,
NewsAPI).

**We deliberately don't do that.** Instead, our own NER pipeline (spaCy+fuzzy
and the LLM) runs on *every* article, regardless of source — and for the
subset that has native tags, we compare our independent extraction against
theirs afterward as a validation step, not fold their tags into our confidence
math.

Why: mixing "our own detection" and "a provider's pre-existing tag" into one
confidence score conflates two different things (our extraction quality vs.
their extraction quality) and would make the result impossible to audit. Being
able to say *"our independent pipeline agreed with Alpha Vantage's tagging on
X% of articles"* is a genuinely useful, honest validation artifact for the
presentation — but only if our pipeline was actually independent to begin
with.

## 3. Text input

Extraction runs on `full_text` where it was successfully scraped (~87% of
articles, per the ingestion build), falling back to `summary` for the rest.
Full text is materially richer for entity mentions than a 1-3 sentence summary
(or, for Google News RSS, a near-empty cleaned summary) — see
`architecture/news_ingestion.md` for why those fields are as thin as they are.

## 4. The two extraction methods

### 4a. spaCy + fuzzy match

1. Run a transformer-based spaCy model (`en_core_web_trf`) over the article
   text, extract spans labeled `ORG`.
2. Fuzzy-match each span against a reference table of real companies (see
   §6) using rapidfuzz's `WRatio` (handles reordered/partial tokens, e.g.
   "Apple" vs. "Apple Inc.").
3. Anything below an **0.85 similarity floor is discarded outright** — a bad
   match is noise, not a weak signal, and letting it through as "found, low
   confidence" would just clutter the candidate list with junk.
4. **A second, stricter check confirms the match**: `token_sort_ratio` between
   the same two (already-normalized) strings must also clear 60. This was added
   after empirical testing found `WRatio` alone unsafe — its partial-ratio
   component happily scores a short span like "NATO" at 90 against "Stevanato
   Group" purely because it's a substring, and "Diehl Defence" at 90 against
   "IEH Corp" the same way. `token_sort_ratio` is a strict full-string
   comparison and stays low (~35) for those coincidences while staying high for
   genuine matches (corporate-suffix differences are already eliminated by
   normalization on both sides, so this doesn't reject legitimate partial
   matches, only substring coincidences).
5. The SEC EDGAR reference list itself is **deduplicated by canonical
   company** before matching, not just by ticker. EDGAR lists the same company
   multiple times when it has more than one listed security (Duke Energy: DUK
   common, DUKB and DUK-PA preferred) — left as-is, a correct match looks
   "ambiguous" (it ties with itself) and can resolve to a preferred/debt ticker
   instead of common stock. Entries are grouped by normalized name and the
   canonical one is kept (no hyphen in the ticker, shortest as tiebreak).

**Confidence formula:**

```
confidence = fuzzy_score × margin_discount × genericness_penalty
```

- **`fuzzy_score`** — rapidfuzz similarity, normalized to 0–1. This is the
  dominant signal. Important honesty: spaCy's own NER doesn't expose a clean
  per-entity probability through its standard API (`doc.ents` returns decided,
  discrete spans, not confidence floats) — so this confidence is a
  purpose-built heuristic over the *resolution* step, not the model's own
  certainty. spaCy either plausibly found an organization or it didn't; the
  actual uncertainty is in *which* company that span refers to.
- **`margin_discount`** — if the extracted span fuzzy-matches two different
  companies at nearly the same score, that resolution is less trustworthy
  than one with a single, clearly-dominant match:
  `margin = (top_score - second_best_score) / top_score`, scaled into a
  discount floored at 0.5 (a near-tie discounts, it doesn't zero out — it's
  "less sure," not "wrong").
- **`genericness_penalty`** — generic single-word spans ("Bank," "Energy,"
  "Holdings") produce false-positive-prone fuzzy matches far more often than
  distinctive proper nouns. Flat ×0.6 penalty when the normalized span is a
  single token *and* that token is in a small curated list of generic business
  words. Plain span length was tried first and rejected — it penalized
  legitimate short tickers/names ("RTX," "GE," "3M") exactly as much as
  genuinely generic ones ("Bank," "Energy"), which the length alone can't
  distinguish; the `token_sort_ratio` confirmation gate above already screens
  out the spurious-short-match failure mode a length cutoff was meant to
  catch, so genericness only needs to handle real dictionary-word collisions.

### 4b. LLM extraction (Gemini Flash Lite)

Model: `gemini-flash-lite-latest` (an alias that always points at the current
Flash-Lite model, rather than a pinned dated string that goes stale).
Structured extraction over the same text: the model returns
`{company_name, confidence, supporting_quote}` per mention — **deliberately
not a ticker**. Asking the model to also recall a ticker symbol from memory is
a separate, hallucination-prone task; instead, `company_name` is run back
through the exact same `CompanyReference.resolve()` fuzzy-matcher spaCy uses
(§4a). This gives both methods a shared canonical ticker namespace (important
for the noisy-OR combination in §5 to compare like with like) and means an
LLM-identified company that isn't SEC-registered (private, foreign, pre-IPO)
is correctly dropped rather than assigned a made-up symbol.

**Confidence handling:** an LLM's self-reported confidence is known to be
poorly calibrated on its own, so it's never trusted bare. Each returned
`supporting_quote` is checked against the actual source text (substring /
high fuzzy-similarity match). If the quote can't be found in the article, the
model likely hallucinated the association — that mention's confidence is
discounted heavily (×0.3) rather than accepted at face value. This grounding
check is cheap and is the main defense against LLM hallucination in this
pipeline.

**Batching:** up to 15 articles are packed into one prompt (well under
Flash-Lite's context budget), each wrapped in its own
`=== ARTICLE <id> === ... === END ARTICLE <id> ===` markers, with a structured
JSON schema (Pydantic, `response_schema`) keying results back by id — instead
of one API call per article. This is what keeps LLM extraction fast/cheap
enough to run inline with a live search rather than as an overnight job.
The explicit per-article markers replaced a simpler `[id] text` scheme after
testing surfaced a real failure mode: with looser delimiters, the model
occasionally attributed one article's companies to a different article's id
in the same batch (content and id silently mismatched). The markers, plus an
explicit instruction to process articles independently, resolved it in
testing — verified by checking that entities only ever appeared under the
correct article id afterward.

## 5. Combining the two methods

### Layer 1 → Layer 2: per (article, ticker) combination

When both methods independently flag the same ticker in the same article,
that agreement is itself evidence — but a plain average understates it (two
independent 0.8s agreeing is stronger than one 0.8 alone). Combined via
**noisy-OR**:

```
combined = 1 - (1 - confidence_spacy_fuzzy) × (1 - confidence_llm)
```

(If only one method flagged it, `combined` is just that method's confidence.)

### Layer 2 → Layer 3: per-search rollup

The candidate list a user actually reviews aggregates across every article
returned by that keyword search. Rather than collapsing this into one opaque
number, **figures are surfaced separately, not blended**:

- **`mention_count`** — number of distinct articles (from this search) that
  reference this ticker
- **`best_confidence`** — the max Layer-2 combined confidence across those
  articles
- **`best_relevance`** — the max relevance (§5b) seen across those articles

**Default selection rule** (transparent, not a black box):
`pre-select if (mention_count ≥ 2 OR best_confidence ≥ 0.85) AND
best_relevance != "Low"; otherwise pre-deselect` — still shown, just
unchecked, so nothing is hidden from the user, but one-off low-confidence
mentions, and confidently-identified-but-irrelevant ones, don't clutter the
default view.

For any ticker, the UI can show exactly which method(s) found it, in how many
articles, and why it defaulted selected/deselected — no unexplainable score.

## 5b. Relevance: a third, orthogonal dimension

**The problem this solves**: confidence answers "is this really company X" —
it says nothing about whether company X actually *matters* to the search
topic. Found in real testing on a `"lithium batteries"` search: **Apple**
surfaced as a top candidate — high confidence (1.0), 7 articles, both methods
agreeing. Every single mention was genuine (verified by reading the actual
`full_text`, not a scraping artifact) — but the articles were consumer pieces
("phone charging tips," "why your iPhone's battery health indicator
disappeared") that use Apple/iPhone as the running example, not stories about
Apple's business relationship to lithium battery technology. Confidently
identified and completely irrelevant to an investment thesis on the topic can
both be true at once — that's what relevance is for.

**Design decision — folded into the existing LLM call, not a separate pass.**
Considered adding a second batched LLM call dedicated to relevance
assessment, which would cover every candidate regardless of which method
found it. Rejected: it would roughly double the LLM time in a flow that's
already live/inline with a search (27-65s currently). Instead, the query
topic is now passed into the *same* extraction call (§4b), and the model
returns `relevance` + `relevance_reason` alongside `confidence` per company.
Trade-off accepted: relevance is only populated for entities the LLM itself
finds (the `article_entities.relevance`/`relevance_reason` columns are `NULL`
for `spacy_fuzzy` rows) — acceptable since the LLM agrees with spaCy on the
large majority of finds (§9), and a ticker the LLM never independently
corroborated defaults to "not assessed," which does **not** gate selection
(only an explicit `"Low"` does — see the rule above).

**Getting the relevance *definition* right took a second empirical pass.**
The first prompt wording ("does the article substantively connect this
company's business, products, strategy, or investments to the topic")
under-constrained "products" — re-testing the exact Apple/lithium-batteries
case, one article ("why isn't my iPhone's battery health showing anymore")
came back `relevance: "High"`, reasoning that the article "focuses on
lithium-ion battery calibration ... within Apple's ecosystem." Technically
true and useless: a consumer battery-health troubleshooting article is not an
investment-relevant story about Apple's lithium-battery business, even though
it discusses the topic at length. The prompt now explicitly instructs the
model to judge relevance **from an investor's perspective** — consumer tips/
reviews/how-tos are `"Low"` even when they discuss the search topic
extensively, because the bar is "would this shape an investment view of the
company," not "is the topic mentioned." Re-tested after the fix: the same
Apple/lithium-batteries case correctly resolved to `best_relevance: "Low"`,
`default_selected: False`.

## 6. Reference data for fuzzy resolution

**SEC EDGAR's `company_tickers.json`** (~10,000 issuers, official
ticker↔CIK↔company-name mapping, free, no key required) — not the S&P 500
list pulled earlier for the ingestion build. Stage A is keyword-driven, not
scoped to the S&P 500, so a smaller-cap or non-index name mentioned in an
article would fail resolution against the 503-company list entirely. Company
names are normalized (common suffixes like "Inc.", "Corp.", "Ltd." stripped)
before indexing, to improve match quality against how spaCy spans and casual
news references actually write company names.

### 6a. Reused for manual company lookup, not just NER resolution

`CompanyReference` gained a second entry point, `search(query, limit=8)`,
that powers the "add a company" search box on the Companies page (`/api/
company-search` → `searchCompanies()` → `AddCompanySearch` in
`CompaniesPage.jsx`) — a way to jump straight to Stage B for a specific
ticker without going through a Stage A keyword search and the NER candidate
list at all.

This is a different task from `resolve()`, so it isn't just `resolve()` with
a lower floor:

- **No score floor.** `resolve()` is an automated decision behind a
  confidence number, so a bad match must be rejected outright. `search()`
  feeds a human-reviewed autocomplete dropdown, so it's fine (expected, even)
  to return loose matches for a two-character query — the user picks.
- **Ticker-prefix and name-prefix matches are ranked ahead of fuzzy matches.**
  Found necessary in practice: `WRatio`'s partial-ratio component otherwise
  buries an exact prefix hit like "Apple Inc." below unrelated
  partial-substring hits ("Applied ...", "...pineapple...") for a query like
  "appl" — the same partial-ratio failure mode `resolve()`'s
  `token_sort_ratio` confirmation gate exists to guard against (§4a), handled
  differently here because there's no confirmation step to lean on before a
  human sees the results.

## 7. Benchmark comparison against native tags (QA, not input)

For articles from Alpha Vantage/Yahoo Search (which carry native ticker tags
in `raw_payload`), after our own pipeline runs: compute agreement between our
extracted ticker set and the provider's tagged set for that article
(precision-like: of what we found, how much they also tagged; recall-like: of
what they tagged, how much we also found). This is computed on read, not
stored — it's a validation report, not a persisted signal.

## 8. Database schema

One new table, added to the existing shared `data/sentiment_investment.db`
(new tables are additive via `CREATE TABLE IF NOT EXISTS`, no migration
machinery needed — unlike adding columns to an already-populated table, which
is why the ingestion build's `full_text` columns needed the `_MIGRATIONS`
list but this doesn't):

### `article_entities`

Stores raw Layer-1 detections only — one row per (article, ticker, method).
Layer 2 and Layer 3 are computed on read via SQL aggregation, not stored
redundantly, so they're always consistent with the underlying detections.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `article_id` | INTEGER, FK → `articles.id` | |
| `ticker` | TEXT | |
| `company_name` | TEXT | Canonical name from the SEC EDGAR reference |
| `method` | TEXT | `'spacy_fuzzy'` or `'llm'` |
| `confidence` | REAL | Per-method confidence as defined in §4 |
| `evidence_text` | TEXT | The matched span (spaCy) or supporting quote (LLM) — kept for auditability |
| `relevance` | TEXT, nullable | `'High'`/`'Medium'`/`'Low'` (§5b) — only populated for `method='llm'` rows; `NULL` for `spacy_fuzzy` and for rows inserted before this was added |
| `relevance_reason` | TEXT, nullable | One-sentence justification from the model |
| `created_at` | TEXT | ISO 8601 UTC |

(`relevance`/`relevance_reason` were added via the same additive-migration
mechanism as `articles.full_text` — see `Database._MIGRATIONS` — since
`article_entities` already had rows from earlier testing.)

### `article_entity_runs`

Added after an idempotency bug surfaced in testing: `article_entities` only
stores *positive* detections, so an article that genuinely mentions no
company (no rows inserted) looked indistinguishable from "never processed" —
every re-run of a search was re-paying for spaCy *and* LLM extraction on those
articles. This table just marks that extraction was attempted, regardless of
outcome, and is what `get_articles_missing_entities` actually checks against.

| Column | Type | Notes |
|---|---|---|
| `article_id` | INTEGER PK, FK → `articles.id` | |
| `processed_at` | TEXT | ISO 8601 UTC |

## 9. Validated on real data

Run end-to-end against articles already sitting in the database from earlier
Stage A searches (not synthetic test data):

| Query | Articles | Time | Notes |
|---|---|---|---|
| `"AI"` | 33 | 26.8s | 32 candidate tickers surfaced |
| `"quantum computing"` | 50 | 53.7s | 88% average agreement with Alpha Vantage's native tags across 40 benchmarked articles |

Re-running an already-processed query completes in ~1s (0 articles
re-processed) — confirms the idempotency fix above actually works, not just
in theory.

The SEC EDGAR reference dropped from 9,304 raw entries to 7,627 after the
canonical-company dedup in §4a step 5 (roughly 1,700 entries were duplicate
securities of an already-listed company).

Two categories of benchmark disagreement showed up and are expected, not
bugs: (1) Alpha Vantage's native tags sometimes include non-equity symbols
(market indices like `^DJI`, pre-IPO/private placements suffixed `.PVT`) that
have no real ticker to resolve to — our pipeline correctly excludes these
rather than miscounting them as misses; (2) occasional genuine one-sided
misses in both directions (a company our pipeline caught that AV didn't tag,
or vice versa) — visible in the `only_native`/`only_ours` fields per article,
not hidden.

## 10. Since this doc was written

Both items originally tracked here as "not built yet" now are:

- The webapp candidate-list UI (`CompanyEntitiesCard.jsx`) — checkboxes with
  the default-selection rule from §5 pre-applied, select all/clear, a
  per-ticker "filter articles to this ticker" toggle, and "Proceed to Stage
  B →" driving `POST /api/stage-b/trigger`.
- Stage B ingestion clients — `benzinga_client.py`, `alpha_vantage_client.py`
  (`fetch_by_ticker`), `yahoo_ticker_news_client.py` — all implemented and
  wired into `src/ingestion/pipeline.py`.

Also added since: the manual company-lookup path via `CompanyReference.
search()` (§6a), which skips Stage A/NER entirely for a user who already
knows the ticker they want.
