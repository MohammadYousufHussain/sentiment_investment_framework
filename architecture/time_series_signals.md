# Time Series & Signal Detection

## 1. Where this fits in the pipeline

```
Stage B (ticker-scoped ingestion) → Sentiment analysis (per-article, per-ticker)
                                            │
                                            v
                    Time series & signal detection (this build)
                                            │
                                            v
     Fundamentals / quantitative validation, Integrated Scoring,
     Comparables, Investment Thesis (all built -- see architecture/README.md)
```

Consumes `article_sentiment` (built in the sentiment-analysis phase) plus
`articles.published_at`. Nothing new is persisted — same "raw data stored,
aggregates computed on read" principle as NER and sentiment (see their docs
§8/§6) — this is pure computation over what's already there.

## 2. The finding this design has to survive: coverage is heavily front-loaded

Before designing signal detection, the actual shape of the data was checked
directly rather than assumed. Age-bucketed article counts across 8 real
tickers (MSFT, NVDA, META, AMZN, WDC, MU, AVGO, AMD), all ingested via Stage B:

| Ticker | Total | 0-3d | 4-7d | 8-14d | 15-30d | 30d+ |
|---|---|---|---|---|---|---|
| MSFT | 89 | 65 | 5 | 0 | 3 | 16 |
| NVDA | 85 | 64 | 8 | 3 | 9 | 1 |
| META | 78 | 56 | 9 | 2 | 10 | 1 |
| AMZN | 81 | 59 | 5 | 3 | 14 | 0 |
| WDC | 95 | 50 | 30 | 4 | 11 | 0 |
| MU | 71 | 52 | 6 | 6 | 6 | 1 |
| AVGO | 66 | 40 | 6 | 5 | 14 | 1 |
| AMD | 72 | 49 | 9 | 3 | 8 | 3 |

The pattern is consistent, not ticker-specific: **60-75% of every ticker's
coverage is from the last 3 days**, thinning sharply further back, with a
long thin tail out to about a month. This is a direct consequence of how
Stage A/B's sources work — NewsAPI, Google News, and Alpha Vantage's default
query windows are all recency-biased — not a data quality problem to fix, but
a real constraint the signal-detection design has to be built around.

**The consequence for design**: a naive daily time series (one sentiment
value per calendar day, trend/inflection detection on the raw daily series)
would be dominated by noise on the sparse older days — a day with one article
can swing wildly and look like a dramatic inflection purely from small-sample
variance, not a real shift in coverage. Any signal detector built on this data
has to treat volume as a first-class input, not an afterthought.

## 3. Numeric sentiment scale

Reuses the same ordinal rank already defined in the sentiment ensemble
(`LABEL_RANK`, see `architecture/sentiment_analysis.md` §4):
`Bearish=-2, Somewhat-Bearish=-1, Neutral=0, Somewhat-Bullish=1, Bullish=2`.
No new scale invented — this keeps the categorical decision made earlier
(§ "What scale should the sentiment score itself use?") consistent all the
way through to the signal layer instead of quietly reintroducing a continuous
score at the last step.

Each article's combined sentiment result (from `ensemble.combine_article_sentiment`)
contributes `(rank, confidence)` to its window; a window's aggregate is a
**confidence-weighted mean rank**, not a plain average — an article both
methods agreed on with high confidence should count for more than a
low-confidence single-method read.

## 4. Windows, not daily buckets

Given §2's finding, three fixed windows are used instead of per-day buckets,
each wide enough to reliably clear a minimum sample size across every ticker
tested:

| Window | Range | Role |
|---|---|---|
| **Recent** | last 0-3 days | "What's happening right now" — always well-populated (40-65 articles in testing) |
| **Mid** | 4-14 days ago | "The recent past to compare against" — combining what would otherwise be two thin buckets (4-7d, 8-14d) into one gives every tested ticker ≥5 articles, vs. some individual sub-buckets having as few as 0 |
| **Historical** | 15-30+ days ago | Longer-horizon context, used to confirm a trend is more than a two-window blip |

**Minimum volume gate**: `MIN_VOLUME_THRESHOLD = 3` articles. A window with
fewer articles than this is marked `insufficient_data` and excluded from
signal detection entirely, rather than silently computing a mean off 1-2
articles and presenting it with the same confidence as a 50-article window.
Validated against all 8 test tickers: every Recent and Mid window cleared
this bar; Historical occasionally sat right at the edge (MU: 7, AMZN: 14) but
never below it in this sample — still checked live per ticker, not assumed.

## 5. Signal definitions

All three require both windows involved to individually clear the volume
gate (§4) — a signal is never reported off an `insufficient_data` window.

- **Sharp inflection**: `|Recent_mean - Mid_mean| ≥ 1.0` (a full label-category
  jump, e.g. Neutral → Somewhat-Bullish or further) — direction (up/down)
  reported explicitly, not just "changed."
- **Sustained positivity / negativity**: Recent *and* Mid means both clear
  `±0.5` in the same direction (roughly, both at least "Somewhat-X" or
  stronger) — distinguishes a real sustained lean from a sharp inflection
  that just started this window.
- **Negative→positive turnaround** (or the reverse): Mid mean `≤ -0.5` *and*
  Recent mean `≥ +0.5` — a genuine sign flip between windows, not just
  "got less negative."

## 6. Reliability tagging, not a bare signal

Every detected signal carries a reliability tag derived from the combined
volume of the windows behind it — **Strong** (both windows ≥ 10 articles),
**Moderate** (both ≥ 5), or **Weak** (clears the §4 gate but thinner than
that) — surfaced alongside the signal itself, the same "don't hide the
uncertainty" principle used for NER's confidence and sentiment's agreement
flag. A "sharp inflection" on two 3-article windows and one on two 40-article
windows are not equally trustworthy claims, and the output says so rather
than presenting them identically.

## 7. Since this doc was written

**Built:** Fundamentals/quantitative validation, and everything downstream
of it, consuming this phase's output extensively:

- The **Sentiment factor** in the Integrated Scoring composite is a
  recency-weighted blend of exactly the Recent/Mid windows this doc defines
  (see `architecture/integrated_scoring.md`).
- **Comparables** and the **Investment Thesis** stock pitch both cite the
  detected signals (sharp inflection, sustained positivity/negativity,
  turnaround) directly in their LLM prompts as grounded evidence — see
  `architecture/comparables.md` and `architecture/investment_thesis.md`.
- The signals/windows themselves are deliberately **excluded** from the
  Integrated Scoring composite math, on purpose — see
  `architecture/integrated_scoring.md`'s note on why a noisy, single-day-news
  -driven signal doesn't belong in a value meant to be stable enough to rank
  companies against each other. They stay a qualitative overlay on the
  Sentiment & News tab instead.

**Still not built:** persisting computed windows/signals — still recomputed
on every request (§1's "nothing new is persisted" principle, still accurate;
fast enough at current data volume, would need caching or a materialized
table if ticker/article count grows substantially).
