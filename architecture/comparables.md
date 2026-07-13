# Comparables — How It Generates

## 1. Where this fits in the pipeline

```
Integrated Scoring math (architecture/integrated_scoring.md)
   │  (computeIntegratedScore, reused verbatim)
   v
Peer identification (sector rules + one LLM call, cached 6h)
   │
   v
Side-by-side scorecard, same weights across every column
   │
   v
On-demand AI rationale: valuation (1 LLM call) + sentiment (1 LLM call), fired in parallel
```

Comparables is not a separate scoring system — it's the Integrated Scoring
tab's exact composite math (`computeIntegratedScore`, see
`architecture/integrated_scoring.md` §6) applied to several companies under
one shared set of weights, plus two things unique to this tab: peer
identification, and an AI-generated target-vs-peers rationale. This doc
covers those two generation steps; the scoring math itself is documented
once, in `integrated_scoring.md`, and deliberately not repeated here.

## 2. Peer identification: light-touch, not a research task

`src/valuation/peer_selection.py`'s `suggest_peers(ticker, n=3, refresh=False)`
is deliberately a two-stage, cheap pipeline rather than an open-ended "find
me good comps" LLM call:

1. **Rule-based candidate pool**: `sector_peers.SECTOR_PEERS` — a curated,
   static large/mid-cap list keyed by GICS-style sector (from the ticker's
   `yfinance` info) — supplies the candidate universe. This is intentionally
   a *broader, coarser* pool than the final output: same sector, not
   necessarily the same industry or business model.
2. **One LLM call to refine**: the candidate list, plus the target's sector
   and industry, is handed to `gemini-flash-lite-latest` with instructions
   to pick the `n` (3) most relevant *direct* comps — same specific
   industry/sub-sector and business model preferred over merely sharing the
   broad sector — and allowed to suggest a better real, currently-listed
   comp not on the candidate list if it knows one. Each suggestion returns a
   one-sentence `reason`, shown under its ticker on the page.

This is explicitly a different, smaller job than `qis_factors.py`'s older
~10-name cross-sectional peer-relative percentile universe (kept in the
codebase, not wired into any current tab) — that one needs a broad enough
set to rank against; this one needs a short, curated shortlist meant for a
side-by-side comparison a person can actually read.

**Caching**: keyed by ticker, 6-hour TTL (`CACHE_TTL_SECONDS = 6*3600`) — far
longer than the 15-minute snapshot cache the underlying fundamentals ride
on, since peer relationships genuinely don't shift week to week the way
price or sentiment does, and every cache miss burns a real LLM call.
`GET /api/companies/<ticker>/peers?refresh=true` bypasses the cache (the
page's "↻ Regenerate suggestions" button).

**Fully editable after suggestion**: the 3 peer slots seeded from
`suggest_peers` are plain editable ticker inputs (`PeerInput` in
`ComparablesTab.jsx`) — a user can override any suggestion with their own
ticker, which re-triggers the scoring fetch and rationale generation for the
new set but does not call the peer-suggestion LLM again.

## 3. The scorecard: one shared weight set, two independent visual signals

Every column (target + up to 3 peers) is scored with the exact same
`factorWeights` / `sentimentWindowWeights` / `metricWeights` — there is
deliberately no per-company weight override, since that would defeat the
point of an apples-to-apples comparison. Weights seed from whatever was
last locked on Integrated Scoring / Quantitative Valuation
(`weightsStore.js`, see `architecture/integrated_scoring.md` §5), then are
freely editable on this page on top of that starting point — edits here
never write back to the lock.

Each cell (`ScoreCell`) carries two **independent** visual signals that are
deliberately not collapsed into one:
- **`isTarget`** — tints the whole column so the ticker being analyzed
  (as opposed to its peers) is always identifiable regardless of how it
  scores.
- **`isWinner`** — rings whichever cell holds the *highest score in that
  specific row*, which may or may not be the target, and can land on more
  than one cell on an exact tie.

A cell can be both — a target that also happens to lead a given factor gets
both the tint and the ring.

**Expandable rows** drill from a factor down to its underlying metrics
(reusing the same `historical.factors[key].raw` shape every valuation
factor card uses) or, for Sentiment, down to its three windows
(`recent`/`mid`/`historical`, showing each column's `mean_rank` and article
count) — the same underlying data `computeIntegratedScore` already
consumed to produce the row above it, just unrolled for inspection rather
than recomputed.

## 4. The AI rationale: two calls, fired in parallel, grounded strictly in what's on screen

`POST /api/companies/<ticker>/comparables-rationale` (body: `{"peers":
[...]}`) runs two independent LLM calls concurrently via a
`ThreadPoolExecutor` and returns `{"valuation": {...}, "sentiment": {...}}`.
This mirrors the multi-call pattern used everywhere else in this app
(`architecture/investment_thesis.md` §2) — one call per distinct evidence
type, not a single mega-prompt trying to reason over both fundamentals and
news at once, and not one call per individual metric either.

**Valuation rationale** (`src/valuation/rationale.py`,
`generate_valuation_rationale`): one call, bundling all four factors. For
each factor, `_factor_block` assembles a plain-text block of every metric's
current value and direction-adjusted z-score for the target and each peer
(`{ticker}={value} (z={score})`), pulled from the same
`build_historical_scorecard` output already on screen. The LLM returns one
2-3 sentence paragraph per factor (`ValuationRationale` schema:
`value, quality, growth, momentum`), framed from the target's perspective —
ahead or behind peers, and which specific metrics explain why.

**Sentiment rationale** (`src/signals/rationale.py`,
`generate_sentiment_rationale`): one call, bundling all three windows.
`_top_articles_for_ticker` finds each ticker's single most-bullish and
most-bearish scored article per window (via the same relevance-weighted
`combine_article_sentiment` result already used for the ticker's aggregate
sentiment — incidental-relevance articles excluded, consistent with how
they're excluded from scoring). For a peer, only its single most notable
article (bullish or bearish, whichever has the larger absolute rank) is
included, and only if that peer actually has ingested coverage in that
window — never fabricated or speculated. Returns one 2-3 sentence paragraph
per window (`SentimentRationale` schema: `recent, mid, historical`), plus
the underlying `articles` dict so a caller can link straight to the
specific headline behind each read.

**Grounding contract**: both prompts carry an explicit instruction that the
model's *only* source of fact is the evidence assembled into the prompt —
not its pretrained knowledge of the target or its peers (real investments,
partnerships, launches, management commentary). Every number in the
valuation rationale must be copied from a number given, never computed or
estimated; every claim in the sentiment rationale must trace to a specific
headline and its attached reasoning, never extended with outside context.
Both run at `temperature=0.3` for a flat, precise, institutional-research-note
register rather than a promotional one. This is the same grounding-contract
pattern adopted app-wide after an earlier hallucination issue surfaced on
the Investment Thesis page — see `architecture/investment_thesis.md` §5.

**Not re-fired on every weight change**: the rationale effect fires once
per `(ticker, peer set)` — deliberately *not* keyed on the weight sliders,
since the rationale is about the underlying metric/news evidence, which
doesn't change when the composite is reweighted. Changing a weight
re-renders the scorecard instantly (pure client-side recomputation over
already-fetched data) without burning another LLM call; only a new peer set
or the explicit "↻ Regenerate rationale" button does.

## 5. Since this doc was written

This doc describes Comparables as built: sector-rule + one-call peer
refinement, shared-weight scorecard reusing Integrated Scoring's math
verbatim, and a two-call (valuation + sentiment) grounded rationale fired
once per target/peer set. If the peer-selection candidate pool, the
rationale prompt structure, or the caching TTLs change materially, update
this section rather than the ones above.
