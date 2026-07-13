import { useState } from 'react'
import WeightInput from './WeightInput'
import WeightTotal from './WeightTotal'
import {
  normalCdf, sentimentLevelToScore, equalWeights, shareOfTotal, zTone, TONE_BAR, TONE_TEXT,
  VALUATION_FACTOR_ORDER, FACTOR_ORDER, SENTIMENT_WINDOW_ORDER, SENTIMENT_DEFAULT_WEIGHTS,
  computeValuationFactorZs, computeSentimentZ, computeComposite,
} from '../lib/factorScoring'
import {
  getLockedMetricWeights, getLockedFactorWeights, getLockedSentimentWindowWeights, lockFactorAndSentimentWeights,
} from '../lib/weightsStore'

// Combines the Quantitative Valuation historical factor scorecard (Value,
// Quality, Growth, Momentum -- each already a direction-adjusted z-score vs.
// this company's own trailing history) with a Sentiment factor built from
// the signals windows (recent/mid/historical mean sentiment rank, already on
// a -2..+2 scale where positive is favorable) into one weighted composite.
// The underlying math (factorScoring.js) is shared with the Comparables
// tab, which runs the same computation across several companies at once.
//
// Deliberately excludes the sharp-inflection/sustained-positivity/turnaround
// signals from this scoring math -- those fire off the same recent-vs-mid
// data already feeding the Sentiment factor's level, so scoring them too
// would double-count it, and they're inherently noisier (single-day news
// flow) than something that should sit in a stable, rankable composite.
// They stay on the Sentiment & News tab as a change-detection overlay.

const FACTOR_DESCRIPTIONS = {
  value: 'Cheapness relative to earnings, EBITDA, cash generation, and book value -- vs. this company’s own trailing history.',
  quality: 'Profitability, capital efficiency, and balance-sheet strength, tracked over its own reporting history.',
  growth: 'Revenue and earnings expansion vs. this company’s own trend.',
  momentum: 'Vol-adjusted 12-month price trend (skipping the most recent month), vs. its own rolling history.',
  sentiment: 'News sentiment level, blended across the recent (0-3d) and mid (4-14d) windows -- recency-weighted by default so a fresh shift outweighs a stale one, but every window is adjustable below.',
}

const SENTIMENT_WINDOW_LABELS = { recent: 'Recent (0-3d)', mid: 'Mid (4-14d)', historical: 'Historical (15-30d)' }

const SENTIMENT_METHOD_NOTE = `This is a weighted level, not a z-score like the four factors above -- Value/Quality/Growth/Momentum are each standardized against this company's own multi-year trailing distribution, but there isn't yet enough sentiment history (the DB only spans a couple of months) to build that same self-relative baseline for sentiment. The alternative -- a statistical z vs. neutral, using article-level dispersion -- was deliberately not used either: it scales with how many articles got written, not how strong the sentiment actually is, so a heavily-covered mega-cap would read as more "extreme" than a thinly-covered name purely from coverage volume. The -2..+2 level avoids that distortion and is already bounded and zero-centered, which is enough to blend sensibly here.`

const PERCENT_METRICS = new Set(['fcf_yield', 'operating_margin', 'return_on_equity', 'revenue_growth', 'eps_growth'])
const MULTIPLE_METRICS = new Set(['trailing_pe', 'ev_to_ebitda', 'price_to_book', 'debt_to_equity', 'cash_conversion'])

function formatMetric(key, value) {
  if (value == null) return '—'
  if (PERCENT_METRICS.has(key)) return `${(value * 100).toFixed(1)}%`
  if (MULTIPLE_METRICS.has(key)) return `${value.toFixed(2)}x`
  return value.toFixed(2)
}

function rankLabel(v) {
  if (v == null) return 'No data'
  if (v >= 1.5) return 'Bullish'
  if (v >= 0.5) return 'Somewhat Bullish'
  if (v > -0.5) return 'Neutral'
  if (v > -1.5) return 'Somewhat Bearish'
  return 'Bearish'
}

const SCALE_GRADIENT = { background: 'linear-gradient(to right, var(--color-critical), var(--color-ink-muted) 50%, var(--color-good))' }

function MiniScale({ value }) {
  if (value == null) return <div className="h-1.5 rounded-full mt-1.5 bg-panel" />
  const pct = ((value + 2) / 4) * 100
  return (
    <div className="relative h-1.5 rounded-full mt-1.5" style={SCALE_GRADIENT}>
      <div
        className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-ink ring-2 ring-panel -translate-y-1/2 -translate-x-1/2"
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}

function FactorBar({ label, z, weight, totalWeight, onWeightChange, isSentiment }) {
  const score = z != null ? (isSentiment ? sentimentLevelToScore(z) : normalCdf(z) * 100) : null
  const tone = zTone(z)
  const share = shareOfTotal(weight, totalWeight)
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] font-medium text-ink-secondary w-20 shrink-0">{label}</span>
      <div className="flex-1 h-3.5 rounded-sm bg-panel overflow-hidden">
        <div className={`h-full rounded-sm ${TONE_BAR[tone]}`} style={{ width: `${score ?? 0}%` }} />
      </div>
      <span className={`text-[12px] font-semibold tabular w-14 text-right shrink-0 ${TONE_TEXT[tone]}`}>
        {score != null ? score.toFixed(0) : 'n/a'}
      </span>
      <span className="flex items-center gap-1 shrink-0">
        <WeightInput value={weight} onChange={onWeightChange} title="Relative weight in the overall composite score" />
        <span className="text-[9px] text-ink-muted tabular w-9 text-right">{share != null ? `${share.toFixed(0)}%` : '—'}</span>
      </span>
    </div>
  )
}

function ValuationFactorDetail({ factorKey, factor, factorZ, usingLockedMetricWeights }) {
  const tone = zTone(factorZ)
  const factorScore = factorZ != null ? normalCdf(factorZ) * 100 : null
  return (
    <div className="border border-hairline rounded-lg bg-panel px-3 py-2.5 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] font-semibold text-ink">{factor.label}</span>
        <span className={`text-[10px] font-semibold tabular ${TONE_TEXT[tone]}`}>
          {factorScore != null ? `${factorScore.toFixed(0)} (z ${factorZ >= 0 ? '+' : ''}${factorZ.toFixed(2)})` : 'n/a'}
        </span>
      </div>
      <p className="text-[10px] text-ink-muted leading-relaxed mb-2">{FACTOR_DESCRIPTIONS[factorKey]}</p>
      <div className="space-y-1">
        {Object.entries(factor.raw).map(([key, m]) => {
          const mTone = zTone(m.zscore)
          return (
            <div key={key} className="flex items-center justify-between gap-2 text-[11px] border-t border-hairline first:border-t-0 pt-1 first:pt-0">
              <span className="text-ink-secondary">{m.label}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-ink-muted tabular">{formatMetric(key, m.current)}</span>
                <span className={`font-semibold tabular w-14 text-right ${TONE_TEXT[mTone]}`}>
                  {m.zscore != null ? `z ${m.zscore >= 0 ? '+' : ''}${m.zscore.toFixed(2)}` : 'n/a'}
                </span>
              </span>
            </div>
          )
        })}
      </div>
      <p className="text-[10px] text-ink-muted mt-2">
        {usingLockedMetricWeights
          ? 'Uses the per-metric weights locked on the Quantitative Valuation tab.'
          : 'Equal-weighted within the factor here -- adjust and lock per-metric weights on the Quantitative Valuation tab.'}
      </p>
    </div>
  )
}

function SentimentFactorDetail({ factorZ, windows, weights, onWeightChange, articlesScored }) {
  const tone = zTone(factorZ)
  const factorScore = sentimentLevelToScore(factorZ)
  const [showMethod, setShowMethod] = useState(false)
  const totalWeight = SENTIMENT_WINDOW_ORDER.reduce((s, k) => s + (weights[k] ?? 0), 0)

  if (!windows || articlesScored === 0) {
    return (
      <div className="border border-hairline rounded-lg bg-panel px-3 py-2.5 min-w-0">
        <span className="text-[12px] font-semibold text-ink">Sentiment</span>
        <p className="text-[11px] text-ink-muted mt-1.5">
          No scored articles yet -- visit the Sentiment &amp; News tab first to run sentiment analysis, then this
          factor will populate.
        </p>
      </div>
    )
  }

  return (
    <div className="border border-hairline rounded-lg bg-panel px-3 py-2.5 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] font-semibold text-ink">Sentiment</span>
        <span className={`text-[10px] font-semibold tabular ${TONE_TEXT[tone]}`}>
          {factorScore != null ? `${factorScore.toFixed(0)} (level ${factorZ >= 0 ? '+' : ''}${factorZ.toFixed(2)})` : 'n/a'}
        </span>
      </div>
      <p className="text-[10px] text-ink-muted leading-relaxed mb-2">{FACTOR_DESCRIPTIONS.sentiment}</p>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wide text-ink-muted">Window weights</span>
        <WeightTotal total={totalWeight} />
      </div>
      <div className="space-y-2">
        {SENTIMENT_WINDOW_ORDER.map((key) => {
          const w = windows[key]
          const insufficient = !w || w.insufficient_data
          const value = insufficient ? null : w.mean_rank
          const wTone = zTone(value)
          const share = shareOfTotal(weights[key] ?? 0, totalWeight)
          return (
            <div key={key} className="border-t border-hairline first:border-t-0 pt-2 first:pt-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] text-ink-secondary">{SENTIMENT_WINDOW_LABELS[key]}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[10px] font-semibold tabular ${TONE_TEXT[wTone]}`}>
                    {value != null ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}` : 'n/a'}
                  </span>
                  <WeightInput value={weights[key] ?? 0} onChange={(v) => onWeightChange(key, v)} title="Relative weight within the Sentiment factor" />
                  <span className="text-[9px] text-ink-muted tabular w-8 text-right">{share != null ? `${share.toFixed(0)}%` : '—'}</span>
                </span>
              </div>
              <p className="text-[10px] text-ink-muted">
                {insufficient ? `Insufficient data (${w?.count ?? 0} article${(w?.count ?? 0) === 1 ? '' : 's'})` : `${rankLabel(value)} · ${w.count} articles`}
              </p>
              <MiniScale value={value} />
            </div>
          )
        })}
      </div>
      <p className="text-[10px] text-ink-muted mt-2">
        Historical window defaults to 0 weight (stale relative to what a live composite should price) -- raise it
        if you want a longer sentiment lookback. Inflection/turnaround signals are tracked separately on the
        Sentiment &amp; News tab, not folded into this score.
      </p>
      <button
        onClick={() => setShowMethod((v) => !v)}
        className="text-[10px] text-ink-muted hover:text-ink-secondary mt-1.5 cursor-pointer"
      >
        {showMethod ? '▲ hide' : '▼ why not a z-score'}
      </button>
      {showMethod && <p className="text-[10px] text-ink-muted leading-relaxed mt-1.5">{SENTIMENT_METHOD_NOTE}</p>}
    </div>
  )
}

export default function IntegratedScorecard({ loading, error, historical, signals }) {
  // Seeded once from whatever was last locked on this page (see
  // lib/weightsStore.js) -- if nothing has ever been locked, these start
  // empty and fall through to the equal-weight/default seeding below,
  // exactly as before. Locking again later overwrites the stored value;
  // it doesn't retroactively change what's already on screen elsewhere.
  const [factorWeights, setFactorWeights] = useState(() => getLockedFactorWeights() || {})
  const [sentimentWeights, setSentimentWeights] = useState(() => getLockedSentimentWindowWeights() || {})
  const [justLocked, setJustLocked] = useState(false)

  if (loading) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-6">
        <div className="flex items-center gap-2.5">
          <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-ink-muted/30 border-t-series-1 animate-spin shrink-0" />
          <p className="text-sm text-ink-secondary">Building integrated scorecard…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-4 text-sm text-critical">
        Failed to load integrated scorecard: {error}
      </div>
    )
  }

  if (!historical) return null

  const seededFactorWeights = Object.keys(factorWeights).length ? factorWeights : equalWeights(FACTOR_ORDER)
  const seededSentimentWeights = Object.keys(sentimentWeights).length ? sentimentWeights : SENTIMENT_DEFAULT_WEIGHTS

  // Each weight is independent -- editing one never touches another's stored
  // value. weightedZ() normalizes by whatever weights are actually present,
  // so nothing requires the group to sum to 100; the "share of total" text
  // next to each field (see shareOfTotal) is a read-only convenience, not a
  // constraint being enforced here.
  function setFactorWeight(key, value) {
    setFactorWeights((prev) => ({ ...(Object.keys(prev).length ? prev : seededFactorWeights), [key]: value }))
  }
  function setSentimentWeight(key, value) {
    setSentimentWeights((prev) => ({ ...(Object.keys(prev).length ? prev : seededSentimentWeights), [key]: value }))
  }
  function handleLock() {
    lockFactorAndSentimentWeights(seededFactorWeights, seededSentimentWeights)
    setJustLocked(true)
    setTimeout(() => setJustLocked(false), 2000)
  }

  // Valuation factors: per-metric weights locked on the Quantitative
  // Valuation tab if any exist, else equal-weighted within the factor
  // (per-metric reweighting itself only happens on the Valuation tab --
  // this page's adjustable weights are the sentiment-vs-quant blend).
  const lockedMetricWeights = getLockedMetricWeights()
  const factorZs = computeValuationFactorZs(historical, lockedMetricWeights)
  const windows = signals?.windows
  const articlesScored = signals?.articles_scored ?? 0
  factorZs.sentiment = computeSentimentZ(windows, seededSentimentWeights)

  const factorTotalWeight = FACTOR_ORDER.reduce((s, key) => s + (seededFactorWeights[key] ?? 0), 0)
  const { compositeZ, compositeScore } = computeComposite(factorZs, seededFactorWeights)
  const compositeTone = zTone(compositeZ)

  const factorLabels = { ...Object.fromEntries(VALUATION_FACTOR_ORDER.map((k) => [k, historical.factors[k].label])), sentiment: 'Sentiment' }

  return (
    <div className="border border-hairline rounded-lg bg-surface px-5 py-4">
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-sm font-semibold">Integrated Scoring</p>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Value, Quality, Growth, and Momentum (each a z-score vs. this company's own trailing history) blended
            with a Sentiment factor built from news sentiment windows (a level, not a z-score -- see the note on
            that card for why). Weights are independent, relative numbers, not percentages that must sum to 100 --
            editing one never changes another; the small % next to each shows its live share of the group.
          </p>
        </div>
        <div className="text-right shrink-0 ml-4">
          <p className={`text-2xl font-semibold tabular ${TONE_TEXT[compositeTone]}`}>
            {compositeScore != null ? compositeScore.toFixed(0) : '—'}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Composite score</p>
          {compositeZ != null && (
            <p className="text-[9px] text-ink-muted mt-0.5">z {compositeZ >= 0 ? '+' : ''}{compositeZ.toFixed(2)}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 mb-1.5">
        <span className="text-[10px] uppercase tracking-wide text-ink-muted">Composite weights</span>
        <span className="flex items-center gap-3">
          <WeightTotal total={factorTotalWeight} />
          <button
            onClick={handleLock}
            title="Carry these factor and sentiment-window weights forward to the Comparables tab"
            className={`text-[10px] font-medium cursor-pointer ${justLocked ? 'text-good' : 'text-ink-muted hover:text-ink-secondary'}`}
          >
            {justLocked ? '✓ Locked' : '🔒 Lock weights'}
          </button>
        </span>
      </div>
      <div className="space-y-2.5 mb-4">
        {FACTOR_ORDER.map((key) => (
          <FactorBar
            key={key}
            label={factorLabels[key]}
            z={factorZs[key]}
            isSentiment={key === 'sentiment'}
            weight={seededFactorWeights[key] ?? 0}
            totalWeight={factorTotalWeight}
            onWeightChange={(v) => setFactorWeight(key, v)}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {VALUATION_FACTOR_ORDER.map((key) => (
          <ValuationFactorDetail
            key={key} factorKey={key} factor={historical.factors[key]} factorZ={factorZs[key]}
            usingLockedMetricWeights={!!lockedMetricWeights?.[key]}
          />
        ))}
        <SentimentFactorDetail
          factorZ={factorZs.sentiment}
          windows={windows}
          weights={seededSentimentWeights}
          onWeightChange={setSentimentWeight}
          articlesScored={articlesScored}
        />
      </div>
    </div>
  )
}
