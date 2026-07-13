# Investment Thesis — How It Generates

This doc covers **two** pages that share one generation chain: **Bull / Bear
Case** (`src/valuation/thesis.py`, Base/Bull/Bear synthesis) and
**Investment Thesis** (`src/valuation/pitch.py`, the stock pitch built on
top of it). They're documented together because the second is explicitly
built by reusing the first's output, not by re-deriving anything from raw
data a second time.

## 1. Where this fits in the pipeline

```
Valuation rationale (1 call)  +  Sentiment rationale (1 call)  +  Detected signals
        (architecture/comparables.md §4)      (time_series_signals.md §5)
                    │                    (fired in parallel via ThreadPoolExecutor)
                    v
        Bull / Bear Case synthesis (1 more call)
        → Base Case / Bull Case / Bear Case, each grounded in the above
                    │
                    v
        Investment Thesis stock pitch (1 more call, reuses the above wholesale)
        → recommendation, thesis statement, pillars, risks, catalysts
        → forced into a specific stance (Bull/Neutral/Bear) if the user asks
```

Four LLM calls total to go from raw metrics/articles to a full stock pitch,
but only two of them are unique to this doc — the valuation and sentiment
rationale calls are the same ones Comparables uses (see
`architecture/comparables.md` §4), reused here rather than re-run, so both
pages stay consistent with what Comparables already says about the same
company.

## 2. Why a chain of small calls, not one mega-prompt

This is the same architectural pattern used throughout the app: **one call
per distinct evidence type, chained**, not a single call trying to reason
over everything from raw numbers, and not one call per atomic fact either.
Concretely:

1. `generate_valuation_rationale` (1 call, bundles Value/Quality/Growth/
   Momentum) — see `architecture/comparables.md` §4.
2. `generate_sentiment_rationale` (1 call, bundles Recent/Mid/Historical) —
   see `architecture/comparables.md` §4. Calls 1 and 2 run **concurrently**
   (`ThreadPoolExecutor(max_workers=2)`), since neither depends on the
   other's output.
3. `generate_investment_thesis`'s own synthesis call — takes the *already
   written* paragraphs from 1 and 2, plus `analyze_signals`'s detected
   signals, and produces the three cases. This call's job is judgment
   (which case is more likely, what would move it), not re-reading raw
   metrics — by the time it runs, another "analyst" (the earlier calls) has
   already done the numeric interpretation.
4. `generate_stock_pitch`'s synthesis call — takes the three cases from
   step 3 wholesale and produces one more level of synthesis: a specific
   recommendation, thesis statement, pillars, risks, catalysts.

Each step's prompt frames the *previous* step's output as "already written
by another analyst on your desk" — deliberately, so the model treats it as
a citable source rather than something to second-guess or re-derive from
first principles.

## 3. Bull / Bear Case: three grounded cases from one synthesis call

`generate_investment_thesis(ticker, db=None, refresh=False)` in
`src/valuation/thesis.py` produces exactly three cases
(`InvestmentThesis` schema: `base_case, bull_case, bear_case`), each a
`{stance: str, points: list[str]}` — one sharp sentence stating the case,
then 4-6 single-sentence bullet points, each required to name a specific
metric, z-score, peer ticker, headline, or detected signal.

**Detected signals as prompt evidence, not scoring input**: `analyze_signals`'s
output (sharp inflection, sustained positivity/negativity, turnaround — see
`architecture/time_series_signals.md` §5) is rendered into prose via
`SIGNAL_DESCRIPTIONS` and included as a fourth evidence block alongside
valuation, sentiment, and the peer set. This is the signals' only role in
this app — cited as grounded qualitative evidence in an LLM prompt, never
fed into the Integrated Scoring composite math (see
`architecture/integrated_scoring.md` §3's note on why).

**Explicit instruction to spread evidence across all five factors,** not
just valuation repeated six ways — checked in the prompt itself ("make sure
you've drawn on valuation, quality, growth, momentum, AND sentiment/news at
least once each"), and an explicit instruction that the bear case shouldn't
just be the bull case negated — each case must surface *different*
evidence, not invert the same points.

## 4. The grounding contract, and the hallucination issue it fixes

An earlier version of this page surfaced ungrounded, unrigorous reasoning —
specifically, a bull-case point that treated a bullish *news* headline as
if it directly justified a *valuation* multiple, without stating any
financial mechanism connecting the two (a large investment announcement is
a sentiment data point; it only becomes a valuation argument once you can
say how it moves revenue, margin, or growth). The fix, still in force in
both `thesis.py`'s and `pitch.py`'s prompts, is a **grounding contract**
with several concrete, checkable rules rather than a vague "be accurate"
instruction:

- **Source-of-fact lockdown**: "your ONLY source of fact is the evidence
  blocks below... If a fact, catalyst, dollar figure, date, or event is not
  written out in the evidence below, it does not exist for the purposes of
  this thesis, even if you are confident it is true in the real world." This
  targets the model's pretrained knowledge specifically — real capex
  programs, partnerships, executive changes it may know about {ticker} but
  that weren't part of what was actually ingested and scored.
- **Numeric lockdown**: every number written must be copied from a number
  that already appears in the evidence — never computed, estimated, or
  introduced.
- **A self-check instruction**: "before finalizing each point, check it
  against this rule: 'can I point to the exact sentence in the evidence
  below that supports this?' ... It is better to write 4 tightly grounded
  points than 6 where two are invented" — explicitly trading completeness
  for rigor.
- **The sentiment-vs-valuation separate-lanes rule** (the specific fix for
  the issue that surfaced): "Do not assert that a news event or sentiment
  catalyst 'justifies,' 'supports,' 'serves as a catalyst for,' or
  'explains' a specific valuation multiple unless the evidence actually
  gives you the financial mechanism connecting them... If you can't state
  that mechanism from the evidence given, phrase it as sentiment only... never
  'X justifies/supports the Y multiple.'"
- **A banned-words list** ("massive," "game-changing," "incredible,"
  "phenomenal," "unprecedented," "remarkable," "structural catalyst," and a
  couple of specific over-claiming phrases) — a cheap, direct lever against
  promotional language, since those words are almost always where
  ungrounded enthusiasm sneaks in.
- **Political-framing guardrail**: when sentiment evidence involves
  political commentary or a public figure's statement, describe the
  underlying business fact rather than repeating the political framing —
  that belongs to the source article, not to an equity thesis.
- **`temperature=0.3`** on both the thesis-synthesis and pitch-synthesis
  calls, deliberately low for an institutional-research-note register
  rather than a more creative/varied one.

This same contract (source-of-fact lockdown, numeric lockdown, banned
words, separate-lanes rule, political-framing guardrail) was then adopted
for the Comparables rationale prompts too (`architecture/comparables.md`
§4) — once the pattern proved out here, it became the house style for every
LLM call in this app that writes analysis prose, not a one-off fix.

## 5. Investment Thesis: the stock pitch, and the stance toggle

`generate_stock_pitch(ticker, stance=None, db=None, refresh=False)` in
`src/valuation/pitch.py` is the actual "would you buy this" document — it
calls `generate_investment_thesis` **without forcing a refresh** (so it
rides that function's own cache whenever a hit exists — see §6) and passes
its three cases plus sentiment evidence wholesale into one more synthesis
call, returning a `StockPitch`: `recommendation` (one of `Bullish` /
`Neutral` / `Bearish`), `thesis_statement` (2-3 sentence elevator pitch),
`pillars` (3-5 `{title, detail}` entries, each grounded in a named metric/
peer/window/signal), `key_risks` (3-4 sentences), `catalysts_to_watch` (2-4
sentences).

**The stance toggle** (`StanceToggle` on the Investment Thesis page: Bull
Case / Neutral / Bear Case buttons) controls the `stance` parameter:

- `stance=None` (auto, the default): `_stance_instruction` tells the model
  to *decide* — weigh how much concrete, high-reliability evidence backs
  bull vs. bear vs. base holding, and set the recommendation to whichever
  the evidence actually favors, using "Neutral" if genuinely mixed rather
  than forcing a direction.
- `stance="Bullish"` / `"Bearish"` / `"Neutral"` (forced): the model is told
  to build the case *for* that specific stance regardless of which case the
  evidence would otherwise favor most — grounding its pillars primarily in
  the matching case's evidence (Bull case → Bullish pitch, Bear case →
  Bearish pitch), while remaining strictly grounded, "just argued from that
  specific angle."

**Semantic inversion of `key_risks` under a forced stance** is the one
place the prompt does something genuinely non-obvious: for a forced
Bullish pitch, `key_risks` means downside risks (drawn from the bear case
evidence) — the normal reading. But for a forced **Bearish** pitch,
`key_risks` is redefined as *risks to the bearish thesis itself* — i.e.
reasons the stock could rally against you, drawn from the bull case
evidence — because "risks" in a short-thesis memo conventionally means
"what could prove this view wrong," not "downside risk," which would be
backwards for a bearish pitch. `_stance_instruction` spells this out
explicitly per stance rather than leaving the model to infer it, since
getting this backwards (listing downside risks in a bearish pitch, which
would just restate the thesis) was an easy, non-obvious mistake to make.

## 6. Caching: two independent layers, so switching stances is fast

Two separate module-level `(time, result)` caches, both 30-minute TTL
(`CACHE_TTL_SECONDS = 1800`), guarded by a `threading.Lock`:

- **`thesis.py`**, keyed by **ticker only** — the three-case synthesis
  doesn't vary by stance or by weights, so it's cached once per ticker. This
  is the expensive step in the chain (two chained LLM calls plus a
  scorecard/peer fetch), and critically doesn't need to be redone when a
  stock pitch is generated for a *different* stance — `generate_stock_pitch`
  calls `generate_investment_thesis` without `refresh=True`, so it rides
  this cache.
- **`pitch.py`**, keyed by **`(ticker, stance or "auto")`** — a tuple key,
  not just ticker, since the pitch genuinely differs by stance. Switching
  between two stances already viewed for a given ticker is then an instant
  cache hit; switching to a stance viewed for the first time still only
  pays for `pitch.py`'s own (cheaper, single) synthesis call, not the
  underlying thesis chain again.

This two-layer design is *why* stance-switching on the Investment Thesis
page is fast after the first load: the expensive shared evidence (valuation
rationale, sentiment rationale, three cases) is computed once and reused
across all three stances; only the final, cheap synthesis call is repeated
per stance. Both pages' "Regenerate" buttons pass `refresh=True` to force a
fresh sample — the Bull/Bear Case tab's regenerate busts the shared
`thesis.py` cache (and therefore implicitly affects any pitch generated
after it), while the Investment Thesis tab's regenerate only busts that
one `(ticker, stance)` entry in `pitch.py`.

## 7. Sentiment evidence shown with receipts, not just prose

Both pages render `SentimentEvidenceBlocks` (a shared component) — the
narrated recent/mid/historical paragraphs alongside the actual bullish/
bearish article cards (title, source, published date, external link) that
`generate_sentiment_rationale` selected as evidence for each window (see
`architecture/comparables.md` §4's description of `_top_articles_for_ticker`).
This lets a reader click straight through to the specific headline behind
a given paragraph's claim, plus an internal link back to the Sentiment &
News tab for that window — the same "don't hide the uncertainty, show your
work" principle used for NER's confidence and sentiment's agreement flag
elsewhere in this app. The Investment Thesis pitch also surfaces the full
Base/Bull/Bear cases it was built from (`result["base_case"]` etc.,
returned alongside the pitch), so a reader can see the underlying analysis
the forced-stance pitch selectively drew from, not just the pitch itself.

## 8. Since this doc was written

This doc describes the chain as built: two parallel rationale calls, one
thesis-synthesis call, one pitch-synthesis call, a shared grounding
contract across all of them, and two independently-keyed caches. If the
chain gains or loses a step, if the stance semantics change, or if the
grounding contract is revised again, update this section (and §4's
hallucination history) rather than silently rewriting the description above
to match new behavior without a record of why it changed.
