// Shared weighted-composite scoring math -- extracted from
// HistoricalFactorScorecard(Beta).jsx so the Integrated Scoring tab can
// combine factor-level scores (including a Sentiment factor built from
// signals windows, which has no z-score of its own) on the same footing
// without duplicating the whole scorecard component.

// Standard normal CDF (Abramowitz & Stegun 26.2.17 approximation) -- used
// only to map a z-score onto a familiar 0-100 "score". The actual math
// (combining metrics into a factor, factors into a composite) always
// happens on the underlying z-scores, never on these post-transform
// 0-100 numbers, since averaging percentiles isn't the same as averaging
// the z-scores that produced them.
export function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  if (z > 0) prob = 1 - prob
  return prob
}

// Sentiment's factor value is a level bounded to [-2, +2] by construction
// (LABEL_RANK), not a statistical z-score -- normalCdf assumes N(0,1), which
// doesn't hold here and saturates a merely "fully bullish" reading (level=2)
// to the same ~98 a genuine 2-sigma outlier would produce for a real z-score
// factor. A plain linear rescale of the known bounded range is honest about
// what the number actually is; used ONLY for Sentiment's own factor score,
// not the blended composite (still normalCdf, standard practice for a
// weighted-average-of-z-scores composite even with one bounded input mixed
// in) and not the other four factors (real z-scores, normalCdf is correct
// there).
export function sentimentLevelToScore(level) {
  if (level == null) return null
  const clamped = Math.max(-2, Math.min(2, level))
  return ((clamped + 2) / 4) * 100
}

export function weightedZ(entries) {
  const valid = entries.filter((e) => e.z != null && e.w > 0)
  if (!valid.length) return null
  const totalW = valid.reduce((s, e) => s + e.w, 0)
  return valid.reduce((s, e) => s + e.z * e.w, 0) / totalW
}

export function equalWeights(keys) {
  const share = Math.round((100 / keys.length) * 10) / 10
  return Object.fromEntries(keys.map((k) => [k, share]))
}

// Sum of every weight currently entered in a group, for the live "share of
// total" readout next to each field -- not used in the actual scoring math
// (weightedZ already normalizes by whatever weights are present), purely so
// an arbitrary number like "35" reads as "that's 28% of this group" without
// forcing the fields to sum to 100 as you type.
export function shareOfTotal(weight, total) {
  if (!total || total <= 0) return null
  return (weight / total) * 100
}

export function zTone(z) {
  if (z == null) return 'neutral'
  if (z >= 0.5) return 'good'
  if (z <= -0.5) return 'critical'
  return 'accent'
}

export const TONE_BAR = { good: 'bg-good', accent: 'bg-series-1', critical: 'bg-critical', neutral: 'bg-ink-muted' }
export const TONE_TEXT = { good: 'text-good', accent: 'text-series-1', critical: 'text-critical', neutral: 'text-ink-muted' }

// The Integrated Scoring framework's shape -- shared between the Scoring tab
// (one company, full breakdown, adjustable weights) and the Comparables tab
// (several companies side by side, fixed default weights) so both are
// guaranteed to be scoring on the same definition, not two copies that can
// drift apart.
export const VALUATION_FACTOR_ORDER = ['value', 'quality', 'growth', 'momentum']
export const FACTOR_ORDER = [...VALUATION_FACTOR_ORDER, 'sentiment']
export const SENTIMENT_WINDOW_ORDER = ['recent', 'mid', 'historical']
export const SENTIMENT_DEFAULT_WEIGHTS = { recent: 70, mid: 30, historical: 0 }

// metricWeights (optional): {value: {metricKey: weight}, quality: {...}, ...}
// -- normally the per-metric weights locked on the Quantitative Valuation
// tab (see lib/weightsStore.js). Metrics not present in metricWeights[factor]
// fall back to equal weight within that factor, and omitting metricWeights
// entirely reproduces the old always-equal-weight behavior.
export function computeValuationFactorZs(historical, metricWeights = null) {
  const factorZs = {}
  for (const key of VALUATION_FACTOR_ORDER) {
    const weights = metricWeights?.[key]
    const entries = Object.entries(historical.factors[key].raw).map(([mKey, m]) => ({
      z: m.zscore, w: weights ? (weights[mKey] ?? 0) : 1,
    }))
    factorZs[key] = weightedZ(entries)
  }
  return factorZs
}

// windows: signals.windows ({recent, mid, historical} -> {mean_rank,
// insufficient_data, count}) or null/undefined if sentiment hasn't been
// scored for this ticker yet. Returns null in that case so callers can
// treat the Sentiment factor as absent rather than zero.
export function computeSentimentZ(windows, sentimentWeights) {
  if (!windows) return null
  const entries = SENTIMENT_WINDOW_ORDER.map((key) => {
    const w = windows[key]
    const value = w && !w.insufficient_data ? w.mean_rank : null
    return { z: value, w: sentimentWeights[key] ?? 0 }
  })
  return weightedZ(entries)
}

// factorZs: {value, quality, growth, momentum, sentiment} -> z (or null).
// factorWeights: {value, quality, growth, momentum, sentiment} -> relative
// weight (need not sum to 100 -- see weightedZ).
export function computeComposite(factorZs, factorWeights) {
  const entries = FACTOR_ORDER.map((key) => ({ z: factorZs[key], w: factorWeights[key] ?? 0 }))
  const compositeZ = weightedZ(entries)
  const compositeScore = compositeZ != null ? normalCdf(compositeZ) * 100 : null
  return { compositeZ, compositeScore }
}

// One-shot convenience for a company given its historical-factors and
// signals API responses -- the Comparables tab's primary entry point, and
// equivalent to what IntegratedScorecard computes internally for a single
// company's detail view.
export function computeIntegratedScore(
  historical, windows, factorWeights, sentimentWeights = SENTIMENT_DEFAULT_WEIGHTS, metricWeights = null,
) {
  const factorZs = computeValuationFactorZs(historical, metricWeights)
  factorZs.sentiment = computeSentimentZ(windows, sentimentWeights)
  const { compositeZ, compositeScore } = computeComposite(factorZs, factorWeights)
  return { factorZs, compositeZ, compositeScore }
}
