# Sentiment Analysis: Ticker-Specific Scoring

## 1. Where this fits in the pipeline

```
Stage A → NER → Stage B (ticker-scoped ingestion, built)
                        │
                        v
        Sentiment analysis runs on every Stage B article
        (this build -- one score per article, for the ticker
         Stage B was run for), streamed to the client via SSE
         since scoring a full ticker can take up to a minute
                        │
                        v
        Time series / signal detection (built -- see
        architecture/time_series_signals.md) -- aggregates
        per-ticker sentiment into recent/mid/historical
        windows, flags sharp inflections, sustained
        positivity, turnarounds
```

**Scope: Stage B articles only.** Every Stage B article already has a known
target ticker by construction (`query_context` = the ticker it was fetched
for) — no entity-resolution step is needed the way NER needed one for Stage A.
Stage A articles are not scored here; they were only ever used to *discover*
candidate tickers, not to build a sentiment history.

## 2. The core design problem: sentiment has to be ticker-aware, not article-aware

A plain sentiment model run over a whole article produces one score for the
whole text. But articles are often mixed: "Apple sues OpenAI over trade
secrets" reads negatively for OpenAI and closer to neutral-or-defensive for
Apple, the aggrieved party. Since the whole point of this scoring is *"how
does this article feel about this specific company,"* a method that can't
distinguish that isn't answering the actual question. Both methods below are
built specifically to be ticker-aware, not just article-aware — this is the
same shape of problem NER's relevance dimension solved (query-aware, not just
article-aware), applied to sentiment instead.

## 3. The two methods

### 3a. FinBERT on ticker-focused snippets

`ProsusAI/finbert` (settled on empirically before building, same as
`en_core_web_trf` was for NER) is the direct analog of spaCy in the NER
build: a real, deterministic, free, locally-run model that satisfies the
case study's literal "apply sentiment analysis" instruction.

Run naively over a whole article, FinBERT is just as un-aware of *which*
company the sentiment is about as spaCy's raw NER was un-aware of *which*
company a span resolved to. The fix here is the same shape as NER's fuzzy
resolution step: **extract only the sentences/snippets that actually mention
the ticker or company name** (simple sentence-splitting + name matching — no
model needed for this step) and run FinBERT on those snippets only, not the
full article. This is a standard "aspect-based sentiment via snippet
extraction" technique — it makes a model with no entity awareness behave as
if it had some, without needing an LLM to do it.

A sentence matches if it contains the ticker (word-boundary match) or the
company's normalized primary name (first word of the name after the same
suffix-stripping NER's `normalize_company_name` does, skipped if that word
is under 3 characters — too likely to false-positive as a substring). If
*no* sentence matches — the ticker/name genuinely doesn't appear in the
scraped text — FinBERT still runs, on the article's opening sentences as a
best-effort fallback rather than being skipped outright, but that result is
flagged lower quality: confidence is discounted ×0.6, since it's a
whole-article read standing in for a ticker-focused one, not a genuine
snippet extraction.

**Confidence — a genuine upgrade over the NER build.** spaCy's NER doesn't
expose a clean per-entity probability (§4a of the NER doc had to build a
heuristic formula for exactly this reason). FinBERT's classification head
*does* output real softmax probabilities per class (positive/negative/
neutral) — no heuristic substitute needed here; the model's own confidence in
its predicted class is used directly.

**Bucketing into the 5-tier scale.** An internal continuous score is computed
as `p_positive - p_negative` (range -1 to 1), then bucketed using **Alpha
Vantage's own published thresholds** (confirmed from AV's live API response
during earlier source evaluation):

| Range | Label |
|---|---|
| `x ≥ 0.35` | Bullish |
| `0.15 ≤ x < 0.35` | Somewhat-Bullish |
| `-0.15 < x < 0.15` | Neutral |
| `-0.35 < x ≤ -0.15` | Somewhat-Bearish |
| `x ≤ -0.35` | Bearish |

Using AV's own boundaries (not just matching their label *names*) is what
makes the benchmark comparison in §5 meaningful — our categories are
numerically grounded the same way theirs are, not just cosmetically similar.

### 3b. LLM ticker-aware sentiment (Gemini, reused)

Ask the model directly: given the article, what's the sentiment specifically
toward `{ticker}`, and why — one of the same 5 categorical labels, plus a
short reasoning and a verbatim supporting quote. Handles mixed-sentiment
articles naturally, since the model reads the whole article with genuine
entity understanding rather than a bag-of-sentences heuristic.

**Also returns a relevance judgment, folded into the same call** — the same
"confidence is not relevance" split NER's §5b makes, applied here instead of
as a separate pass, for the same inline-latency reason NER's §5b gives.
Sentiment's version uses a different three-tier scale from NER's High/
Medium/Low, because the question is subtly different (how central is this
company to the article, not how business-relevant is a search topic to it):
`"Primary"` (the article is substantively about this company),
`"Secondary"` (a meaningful part of the article — a real competitor
comparison, a supplier/customer relationship — but not the main subject), or
`"Incidental"` (a passing reference: a historical comparison, a size/scale
analogy, while the article is actually about something else). This is what
§4's combined confidence is weighted by.

**Grounding, same discipline as NER's LLM extractor.** Self-reported
confidence/labels from an LLM aren't trusted bare — the supporting quote is
checked against the source text (substring / high fuzzy-similarity), and a
quote that can't be found discounts that mention's confidence heavily, same
mechanism as `llm_extractor.py`'s hallucination guard.

**Pre-filtered before the batch call.** An article tagged for a ticker by
source metadata alone (Alpha Vantage's `ticker_sentiment` tags some articles
that never actually mention the company or ticker anywhere in the scraped
text — e.g. broad index-reconstitution roundups) is skipped rather than sent
to the LLM: it can't ground a result for text that isn't there, so the call
would just be wasted. FinBERT still runs on these (its own snippet
extraction has its own opening-sentences fallback, §3a) — only the LLM call
is skipped.

**Batching, same pattern as `llm_extractor.py`.** Articles are packed into one
prompt up to a per-batch limit, each wrapped in its own
`=== ARTICLE <id> === / === END ARTICLE <id> ===` markers (this exact
delimiter style was adopted for NER after testing found looser delimiters
let the model mix up which article an entity belonged to — the same
discipline applies here for the same reason).

## 4. Combining the two methods: relevance-weighted LLM, FinBERT as cross-check

**This section originally described an agree/conflict scheme** (both
methods stored, LLM's label used as tiebreak on conflict). **That's no
longer what the code does** — this section documents the design that
replaced it, once the relevance dimension (§3b) landed.

The problem the old scheme didn't handle: relevance. An article can mention
`{ticker}` only in passing (Incidental) yet still get a confident, clearly-
polarized label from both methods — confident and irrelevant are
independent axes, same finding as NER's §5b, and neither the old agree/
conflict scheme nor a noisy-OR had any way to let a confident-but-Incidental
read count for less. NER's noisy-OR was the wrong shape to begin with here
regardless: that combination worked because *is this the right entity* is
binary and independent agreement genuinely stacks evidence; sentiment is a
directional/ordinal judgment, where two methods "agreeing" doesn't compound
the same way.

**What it does now: the combined result is the LLM's label, at a confidence
discounted by its own relevance call.**

```
combined_confidence = llm_confidence × RELEVANCE_WEIGHT[llm_relevance]
RELEVANCE_WEIGHT = {"Primary": 1.0, "Secondary": 0.5, "Incidental": 0.0}
```

An Incidental mention contributes *nothing* to the ticker's aggregate
sentiment (zero weight, not just a low score) — a passing reference
shouldn't move a sentiment read at all, however clearly-polarized the
sentence around it is. Secondary counts at half weight. Only Primary
mentions count in full. There's no article where this combined result is
`None` unless the LLM never scored it at all (skipped per §3b's pre-filter,
or a batch response that dropped the id) — FinBERT alone is never enough to
produce a combined score, because relevance-weighting requires the LLM's own
relevance call and FinBERT has no relevance signal of its own to weight by.

**FinBERT doesn't disappear — its job changed from "half of the blend" to
"independent cross-check."** It's still run, stored, and shown in its own
column; an `agreement` flag is still computed whenever both rows exist
(`agree` if the two labels' ordinal rank distance is ≤ 1, `conflict` if ≥
2), but that flag no longer changes the combined label or confidence — it's
a QA signal (an article where the two methods read very differently is
worth a second look), not an input. Folding FinBERT into the combined score
had no principled way to apply the same relevance discount to it, since it
has no relevance judgment of its own — better to leave it out of the
combined number entirely than combine it inconsistently.

`label_counts`/`articles_scored` in the per-ticker summary still reflect
every LLM-scored article regardless of relevance weight (§5b's point: an
Incidental article is still a real, correctly-scored read, just zero-weighted
downstream) — it's the window/signal aggregation one level up
(`src/signals/aggregation.py`, see `architecture/time_series_signals.md`)
that actually applies the relevance weight, by using `confidence` (already
relevance-discounted here) as the weight in its confidence-weighted mean.

## 5. Benchmark against Alpha Vantage's native sentiment (QA, not input)

Alpha Vantage already returns a per-ticker `ticker_sentiment` (label + score)
for its own Stage B articles, sitting unused in `raw_payload` until now. Same
principle as NER §2: our own sentiment is computed completely independently,
then compared against AV's afterward as a validation report — never folded
into our own labels or confidence. This is what makes *"our sentiment agreed
with Alpha Vantage's own tagging on X% of articles"* an honest claim rather
than a circular one.

## 6. Database schema

Two new tables, additive (`CREATE TABLE IF NOT EXISTS`, no migration needed),
mirroring the `article_entities` / `article_entity_runs` pattern from NER:

### `article_sentiment`

Raw per-method detections only, one row per (article, ticker, method). The
relevance-weighted combined result and the FinBERT/LLM agreement flag (§4)
are both computed on read, not stored.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `article_id` | INTEGER, FK → `articles.id` | |
| `ticker` | TEXT | Redundant with the article's `query_context` for Stage B specifically, kept for schema consistency with `article_entities` and in case scope ever widens |
| `method` | TEXT | `'finbert'` or `'llm'` |
| `label` | TEXT | One of the 5 AV-style categories |
| `score` | REAL, nullable | FinBERT's internal continuous score (`p_positive - p_negative`) before bucketing; `NULL` for LLM rows, which reason in labels directly |
| `confidence` | REAL | FinBERT: winning-class softmax probability (×0.6 if it fell back to opening sentences, §3a). LLM: self-reported, discounted if ungrounded (§3b) — **not yet relevance-weighted**, that discount is applied on read (§4), not stored |
| `evidence_text` | TEXT | FinBERT: the extracted snippet(s) scored. LLM: the supporting quote |
| `reasoning` | TEXT, nullable | LLM only — its stated justification |
| `relevance` | TEXT, nullable | `'Primary'`/`'Secondary'`/`'Incidental'` (§3b) — LLM only; `NULL` for `finbert` rows |
| `relevance_reason` | TEXT, nullable | LLM only — one-sentence justification |
| `created_at` | TEXT | ISO 8601 UTC |

(Unlike `article_entities`' matching columns, which needed an `ALTER TABLE`
migration since that table predated the relevance concept — see NER doc
§8 — `article_sentiment` was created after relevance was already an
established pattern, so `relevance`/`relevance_reason` are part of its
original `CREATE TABLE` statement, no migration needed.)

### `article_sentiment_runs`

Same idempotency fix NER needed (`article_entity_runs`): marks that scoring
was *attempted* on an article regardless of outcome, so an article that
FinBERT/LLM genuinely can't score isn't re-processed on every re-run.

| Column | Type | Notes |
|---|---|---|
| `article_id` | INTEGER PK, FK → `articles.id` | |
| `processed_at` | TEXT | ISO 8601 UTC |

## 7. Validated on real data

*This validation run predates §4's relevance-weighting redesign — at the
time, "our label" below was the agree/conflict-combined label, not today's
relevance-weighted LLM label. Kept as a historical record rather than
re-run, same treatment as NER doc §9; the directional findings (FinBERT/LLM
disagreements skew toward genuine full-article-context wins, not bugs;
AV disagreement is a neutral-band calibration gap, not a polarity problem)
should still hold, but the exact percentages aren't guaranteed reproducible
against the current combination logic.*

Run against MSFT's 89 already-ingested Stage B articles: completed in 29.5s.

**FinBERT vs. LLM agreement: 67%** (59/88 scored articles), 29 conflicts.
Investigated one conflict directly rather than just reporting the number
(article "My plea to Xbox fans of the divested studios"): FinBERT's
snippet-window scored it `Neutral` (0.85 confidence); the LLM scored it
`Bearish` (0.90 confidence), correctly reading the framing of Microsoft's
management as the article's actual complaint — a genuine case where full-
article context beats a snippet heuristic, exactly the kind of disagreement
the FinBERT/LLM `agreement` cross-check (§4) exists to surface.

**Benchmark vs. Alpha Vantage's native `ticker_sentiment`: 47% exact-label
agreement (23/49)** — investigated rather than taken at face value, since a
number that low is either a real problem or a real finding:

- One early check (article "Palantir, Microsoft, Figma emerge as key AI
  beneficiaries...") looked like a bug — AV called it `Bullish`, we called it
  `Neutral`. Traced to the actual stored `full_text`: only 252 characters,
  scraped successfully (`full_text_status='success'`) but never actually
  mentioning "Microsoft" at all. Both FinBERT (fell back to opening
  sentences, low 0.50 confidence) and the LLM (explicitly reasoned *"the
  excerpt cuts off before mentioning Microsoft"*) responded honestly to
  incomplete data rather than hallucinating a score — this is a full-text
  scraping depth limitation upstream, not a sentiment-logic bug.
- Checking whether this generalized: **disagreement rate was *not* explained
  by short articles** (40% for `full_text < 400` chars vs. 56% for longer
  articles) — so the scraping-depth issue above is real but not the main
  story.
- Cross-tabulating every AV-vs-ours label pair revealed the actual pattern:
  the overwhelming majority of disagreements are AV calling something
  `Somewhat-Bullish`/`Somewhat-Bearish` where we call it `Neutral` — **we are
  systematically more conservative (neutral-leaning) than AV, not randomly
  wrong.** Checked for genuine polarity inversions (AV bullish-side vs. our
  bearish-side or vice versa) specifically: **1/49 (2%)**. The other 25
  disagreements are all "did this clear our neutral bar," never "which
  direction is it."

**Interpretation:** reusing AV's absolute numeric thresholds (§3a) for
bucketing assumed our models' score distributions would center the same way
AV's internal ones do — they don't quite, which is why the Neutral band
catches more of our results than theirs. The directional signal itself is
sound (98% polarity agreement), which is the property that matters most for
the time-series/signal-detection phase this feeds. Recalibrating the
thresholds against our own models' actual score distribution (rather than
reusing AV's absolute numbers) is a reasonable follow-up, not done in this
build — flagged here rather than presented as resolved.

## 8. Since this doc was written

Built:

- **Time-series aggregation and signal detection** — see
  `architecture/time_series_signals.md`. Consumes `article_sentiment`'s
  relevance-weighted `confidence` (§4) directly as the weight in each
  window's confidence-weighted mean rank.
- **Live progress while scoring** — `run_sentiment_analysis_iter` streams
  `{phase: "finbert"|"llm", processed, total}` events over SSE
  (`/api/companies/<ticker>/sentiment-stream`), so a client scoring a
  ticker with ~90 articles (up to a minute of work) shows real progress
  instead of blocking silently (§1).
- **The relevance-weighted combination itself** (§4) — this is the
  redesign this doc update mainly exists to capture; the original
  agree/conflict scheme is gone from the code, kept here only as
  "what this replaced" context.

Still not built:

- Retroactive sentiment scoring for Stage A articles (deferred — see §1).
- Threshold recalibration against our own score distribution (§7) — the
  bucketing in §3a still reuses Alpha Vantage's absolute thresholds
  unchanged.
