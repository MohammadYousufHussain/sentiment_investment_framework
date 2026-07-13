# Integrated Scoring — Methodology

## 1. Where this fits in the pipeline

```
Quantitative Valuation (historical factor scorecard)  +  Signal detection windows
                    │                                           │
                    v                                           v
             Value / Quality / Growth / Momentum         Sentiment factor
             (self-relative z-scores)                     (recency-weighted level)
                    │                                           │
                    └───────────────────┬───────────────────────┘
                                         v
                          Weighted composite (Integrated Scoring tab)
                                         │
                                         v
                   Same math reused for Comparables (architecture/comparables.md)
```

Consumes `build_historical_scorecard` (per-metric self-relative z-scores, see
§2) and `analyze_signals`'s Recent/Mid/Historical windows (see
`architecture/time_series_signals.md` §3-5). Everything downstream — the
factor bars, the composite score, the weight editors — is pure computation
on the frontend over these two already-computed API responses; nothing new
is persisted or scored server-side for this tab specifically.

## 2. The four valuation factors: self-relative, not peer-relative

`src/valuation/historical_factors.py` scores each metric against the
**company's own trailing 12-quarter history**, not against a peer set. This
is a deliberate, different choice from the older `qis_factors.py` module
(percentile-ranked against a peer universe, kept in the codebase but not
wired into any current tab — see that file's docstring), made because a
self-relative read answers a different, equally useful question: *is this
company cheap/strong/growing relative to where it usually sits*, independent
of whether its whole sector is currently in or out of favor.

**The four factors and their metrics** (`METRICS_BY_FACTOR`):

| Factor | Metrics | Direction |
|---|---|---|
| **Value** | Trailing P/E, EV/EBITDA, FCF Yield, Price/Book | lower is better (FCF Yield: higher) |
| **Quality** | Operating Margin, Return on Equity, Debt/Equity, Cash Conversion | higher is better (D/E: lower) |
| **Growth** | Revenue Growth (YoY), EPS Growth (YoY) | higher is better |
| **Momentum** | 12-1 Month Momentum (vol-adjusted) | higher is better |

Each metric is deliberately chosen to capture a genuinely distinct
dimension rather than piling on near-duplicate ratios — Value spans an
earnings-based capital-structure-sensitive measure (P/E), an earnings-based
capital-structure-neutral measure (EV/EBITDA), a cash-based measure (FCF
Yield), and an asset-based measure (P/B); Quality mirrors MSCI's published
Quality factor definition (profitability, leverage, earnings stability).

**How a single metric's z-score is built** (`_build_metric_output`):

1. A quarterly time series is reconstructed from real historical
   fundamentals (Alpha Vantage income statement/balance sheet/cash
   flow/earnings, joined by fiscal date) and real historical prices matched
   to each fiscal date — not today's price applied retroactively.
2. A trailing 12-quarter moving average (`normalized`) is computed at each
   point — the metric's own typical level.
3. `deviation_from_normalized = (current - normalized) / normalized`.
4. `stability` = coefficient of variation (`|stdev / mean|`) of the metric
   over the same trailing 12 quarters — how much a single reading of this
   metric should be trusted, purely from the company's own data.
5. `zscore = (deviation_from_normalized / stability) * direction`. Since
   `deviation_from_normalized ≈ (current - mean)/mean` and `stability =
   stdev/mean`, dividing one by the other cancels the mean and leaves
   `(current - mean)/stdev` — a genuine z-score against the metric's own
   trailing distribution. The `direction` multiplier (`DIRECTION` dict)
   ensures positive always means "favorable," even for lower-is-better
   metrics like P/E.

This replaced an earlier rank-based percentile approach: a metric whose
normalized value sits near zero (e.g. FCF Yield) produces a huge, meaningless
percent deviation on its own, but dividing by a `stability` inflated by that
same near-zero mean keeps the resulting z-score sane.

## 3. The Sentiment factor: a level, not a z-score, and why that matters downstream

`webapp/frontend/src/lib/factorScoring.js`'s `computeSentimentZ` builds a
fifth factor from the Recent/Mid/Historical windows already computed by
signal detection (`architecture/time_series_signals.md` §3-4): a
weighted average of each window's `mean_rank` (the confidence-weighted mean
sentiment label rank, `Bearish=-2 … Bullish=+2`), using per-window weights
the user controls (`SENTIMENT_DEFAULT_WEIGHTS = {recent: 70, mid: 30,
historical: 0}` — recency-weighted by default, historical off by default).
Windows marked `insufficient_data` are excluded via `w: 0` rather than
silently averaged in.

The result is a **level bounded to [-2, +2] by construction** — not a
statistical z-score, because it was never drawn from a distribution with an
unknown mean/variance the way the four valuation metrics were. This
distinction matters for how it's displayed:

- **Composite math** (`computeComposite`) treats it identically to the other
  four factors — a plain weighted average of the five factor values, no
  special-casing. This is standard practice for a composite that's already a
  weighted average of heterogeneous "how many of my own typical swings away
  from normal" numbers; mixing in one bounded input doesn't materially change
  what that composite means.
- **The factor's own displayed 0-100 score** does need to special-case it.
  The other four factors' z-scores are mapped to 0-100 via `normalCdf` (a
  standard-normal CDF approximation) — appropriate because those are real
  z-scores from data with unknown, roughly-normal variance. Running the
  Sentiment level through the same `normalCdf` would be wrong: it assumes
  N(0,1), which doesn't hold for a manufactured [-2,+2] bound, and it
  **saturates** a merely "fully bullish" reading (level = 2) to the same
  ~98 a genuine 2-sigma outlier would produce for a real z-score factor —
  overstating how extreme a maximally-positive-but-bounded sentiment read
  actually is. Instead, `sentimentLevelToScore(level)` does a plain linear
  rescale of the known bounded range: `((clamp(level,-2,2) + 2) / 4) * 100`.
  This is used *only* for Sentiment's own factor-level display score — the
  composite still runs entirely on `normalCdf`, and the other four factors
  still use `normalCdf` for their own display scores too, since `normalCdf`
  is correct there.

The Integrated Scoring tab's Sentiment factor card includes a collapsed
"why isn't this a z-score" explanation inline, so this isn't just documented
here — it's surfaced to whoever is reading the score.

**Deliberately excluded from the composite entirely**: the raw signals
themselves (sharp inflection, sustained positivity/negativity, turnaround —
see `architecture/time_series_signals.md` §5). Those are point-in-time,
often single-news-driven qualitative flags, not something that belongs in a
value meant to be stable enough to rank companies against each other. They
stay a qualitative overlay on the Sentiment & News tab, and get cited
directly (as grounded evidence, not as a scoring input) by the Comparables
rationale and Investment Thesis prompts instead.

## 4. Weighted composite: independent weights, not forced-to-100

`weightedZ(entries)` — the single function all composite math in this app
runs through — takes `{z, w}` pairs, drops any entry with a null z or a
zero/negative weight, and returns `Σ(z·w) / Σ(w)` over what's left. Because
it normalizes by whatever weights are actually present, **weights are never
forced to sum to 100**: entering `50/50/50/50/50` produces exactly the same
composite as `10/10/10/10/10`, and a factor with no data (null z, e.g.
Sentiment before any articles are ingested) is excluded from both the
numerator and the denominator rather than treated as a zero.

This is deliberately different from a typical "must sum to 100%" allocation
UI. The tradeoff: nothing stops a user from entering weights that don't sum
to 100, which could read as a mistake. The UI addresses this with
`shareOfTotal(weight, total)` — a live "that's 28% of this group" readout
next to each field — so an arbitrary-looking number like "35" is legible
without forcing the fields to sum to 100 as you type. This is used at three
levels, each independently weighted:

1. **Metric weights within a factor** (Quantitative Valuation tab) — e.g.
   how much Trailing P/E counts vs. EV/EBITDA within Value.
2. **Window weights within Sentiment** (Integrated Scoring tab) — Recent vs.
   Mid vs. Historical.
3. **Factor weights within the composite** (Integrated Scoring tab) — Value
   vs. Quality vs. Growth vs. Momentum vs. Sentiment.

None of these levels rebalance each other automatically — changing the
Value factor's weight doesn't auto-adjust Quality's, by design, so a user
exploring "what if I cared 2x as much about Growth" can just double that one
number and see the effect, rather than fighting a UI that keeps renormalizing
around them.

`computeComposite` maps the resulting composite z-score back to a display
score via `normalCdf(compositeZ) * 100` — the same standard-normal-CDF
transform used for the four individual valuation factors, applied here to
the blended z rather than to any single factor.

## 5. Weight persistence: "lock and carry forward," not live sync

`webapp/frontend/src/lib/weightsStore.js` persists weights to
`localStorage` (prefix `sentinel.weights.`) so a chosen weighting scheme
survives tab navigation and a hard refresh — treated as a user preference,
not a per-company setting (not keyed by ticker).

This is a **one-way snapshot**, not a live two-way sync. Quantitative
Valuation and Integrated Scoring each keep their own free-editing local
state as before — nothing here changes moment-to-moment as you type on
either page. Only clicking that page's "Lock weights" button
(`lockMetricWeights`, `lockFactorAndSentimentWeights`) snapshots the current
values into `localStorage`, where a fresh visit to Integrated Scoring (for
factor/sentiment-window weights) or the Comparables tab (for all three
levels) picks them up as its *starting* point — still fully editable from
there, never forced back to the locked value on every keystroke. This
avoids two failure modes: silently scoring Comparables on stale defaults the
user never saw, and fighting the user's in-progress edits by resyncing
underneath them.

## 6. Reused verbatim by Comparables

`computeIntegratedScore(historical, windows, factorWeights, sentimentWeights,
metricWeights)` is the single entry point both tabs call — Integrated
Scoring for one company's full breakdown, and Comparables
(`architecture/comparables.md`) for several companies side by side under the
same weights. This is a deliberate single-source-of-truth choice: the two
tabs are guaranteed to be scoring on the exact same definition of "Value" or
"the composite," never two independently-maintained copies of the same math
that could quietly drift apart.

## 7. Since this doc was written

This doc describes the Integrated Scoring tab as built. If the composite
formula, factor set, or weighting UX changes materially, update this section
rather than the sections above, so the reasoning above stays attributable to
the version of the code it actually describes.
