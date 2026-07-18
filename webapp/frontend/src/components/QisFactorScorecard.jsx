import { useState } from 'react'

const FACTOR_ORDER = ['value', 'quality', 'momentum', 'low_volatility', 'crowding']
const HORIZON_KEYS = ['short_term', 'medium_term', 'long_term']

const FACTOR_DESCRIPTIONS = {
  value: 'Cheapness relative to earnings, book value, sales, EBITDA, and cash generation.',
  quality: 'Profitability, capital efficiency, balance-sheet strength, and earnings-to-cash conversion.',
  momentum: '12-month price trend (skipping the most recent month), vol-adjusted, vs. sector and market.',
  low_volatility: 'Realized volatility, market beta, and drawdown depth -- lower is scored higher.',
  crowding: 'Short interest and institutional concentration -- how exposed the stock is to a crowded position unwinding, not a quality signal.',
}

// Formatting differs per metric, not per factor.
const PERCENT_METRICS = new Set([
  'fcf_yield', 'shareholder_yield', 'revenue_growth', 'gross_margin', 'operating_margin', 'net_margin',
  'return_on_equity', 'return_on_assets', 'relative_strength_sector', 'relative_strength_market',
  'annualized_volatility', 'max_drawdown', 'short_percent_of_float', 'institutional_ownership',
])
const MULTIPLE_METRICS = new Set([
  'trailing_pe', 'forward_pe', 'price_to_book', 'price_to_sales', 'ev_to_ebitda', 'debt_to_equity', 'cash_conversion',
])
const DAYS_METRICS = new Set(['short_ratio'])

function formatMetric(key, value) {
  if (value == null) return '—'
  if (PERCENT_METRICS.has(key)) return `${(value * 100).toFixed(1)}%`
  if (MULTIPLE_METRICS.has(key)) return `${value.toFixed(2)}x`
  if (DAYS_METRICS.has(key)) return `${value.toFixed(1)}d`
  return value.toFixed(2)
}

function tierTone(pct) {
  if (pct == null) return 'neutral'
  if (pct >= 66) return 'good'
  if (pct >= 33) return 'accent'
  return 'critical'
}

const TONE_BAR = { good: 'bg-good', accent: 'bg-series-1', critical: 'bg-critical', neutral: 'bg-ink-muted' }
const TONE_TEXT = { good: 'text-good', accent: 'text-series-1', critical: 'text-critical', neutral: 'text-ink-muted' }

function FactorBar({ label, percentile }) {
  const tone = tierTone(percentile)
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] font-medium text-ink-secondary w-32 shrink-0">{label}</span>
      <div className="flex-1 h-3.5 rounded-sm bg-panel overflow-hidden">
        <div className={`h-full rounded-sm ${TONE_BAR[tone]}`} style={{ width: `${percentile ?? 0}%` }} />
      </div>
      <span className={`text-[12px] font-semibold tabular w-16 text-right shrink-0 ${TONE_TEXT[tone]}`}>
        {percentile != null ? `${percentile.toFixed(0)}th pct` : 'n/a'}
      </span>
    </div>
  )
}

// A small "where do I sit vs. peers" bar: track spans the peer set's min-max,
// a muted tick marks the sector mean, and the subject's own marker is
// colored green/red depending on which side of the mean is favorable for
// this specific metric's direction (not just whether the raw number is high).
function MetricPositionBar({ metric }) {
  const { value, sector_mean: mean, sector_min: min, sector_max: max, direction } = metric
  if (value == null || min == null || max == null || min === max) return null

  const pad = (max - min) * 0.1 || Math.abs(max) * 0.1 || 1
  const lo = min - pad
  const span = (max + pad) - lo || 1
  const pctFor = (v) => Math.max(0, Math.min(100, ((v - lo) / span) * 100))

  const valuePct = pctFor(value)
  const meanPct = mean != null ? pctFor(mean) : null
  const favorable = mean != null ? (direction === 1 ? value >= mean : value <= mean) : null
  const dotTone = favorable == null ? 'bg-ink-muted' : favorable ? 'bg-good' : 'bg-critical'

  return (
    <div className="relative h-1.5 rounded-full bg-panel mt-1.5">
      {meanPct != null && <div className="absolute top-0 bottom-0 w-px bg-ink-muted" style={{ left: `${meanPct}%` }} />}
      <div
        className={`absolute top-1/2 w-2.5 h-2.5 rounded-full ring-2 ring-panel -translate-y-1/2 -translate-x-1/2 ${dotTone}`}
        style={{ left: `${valuePct}%` }}
      />
    </div>
  )
}

function MetricRow({ metricKey, metric }) {
  const [expanded, setExpanded] = useState(false)
  const horizons = HORIZON_KEYS.map((h) => metric[h]).filter(Boolean)
  const hasDetail = Boolean(metric.implication || metric.as_of || horizons.length > 0)
  const hasPositionBar = metric.sector_min != null && metric.sector_max != null

  return (
    <div className="border-t border-hairline first:border-t-0 py-2">
      <button
        onClick={() => hasDetail && setExpanded((v) => !v)}
        className={`w-full flex items-center justify-between gap-3 text-left ${hasDetail ? 'cursor-pointer' : ''}`}
      >
        <span className="text-[12px] text-ink-secondary">{metric.label}</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[12px] font-medium text-ink tabular">{formatMetric(metricKey, metric.value)}</span>
          {metric.sector_mean != null && (
            <span className="text-[10px] text-ink-muted tabular whitespace-nowrap">
              avg {formatMetric(metricKey, metric.sector_mean)}
            </span>
          )}
          {hasDetail && <span className="text-ink-muted text-[9px] w-3 text-center">{expanded ? '▲' : '▼'}</span>}
        </div>
      </button>

      {hasPositionBar && <MetricPositionBar metric={metric} />}

      {expanded && hasDetail && (
        <div className="pt-2.5 px-0.5 space-y-2.5">
          {metric.implication && (
            <p className="text-[11px] text-ink-muted leading-relaxed">{metric.implication}</p>
          )}

          {horizons.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {HORIZON_KEYS.map((h) =>
                metric[h] ? (
                  <div key={h} className="border border-hairline rounded-md bg-surface px-2 py-1.5">
                    <p className="text-[9px] uppercase tracking-wide text-ink-muted leading-tight">{metric[h].label}</p>
                    <p className="text-[12px] font-semibold tabular text-ink mt-0.5">{formatMetric(metricKey, metric[h].value)}</p>
                  </div>
                ) : (
                  <div key={h} />
                )
              )}
            </div>
          )}

          {metric.as_of && <p className="text-[10px] text-ink-muted">Data as of {metric.as_of}</p>}
        </div>
      )}
    </div>
  )
}

function FactorDetail({ factorKey, factor }) {
  const tone = tierTone(factor.percentile)
  return (
    <div className="border border-hairline rounded-lg bg-panel px-4 py-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-semibold text-ink">{factor.label}</span>
        <span className={`text-[11px] font-semibold tabular ${TONE_TEXT[tone]}`}>
          {factor.percentile != null ? `${factor.percentile.toFixed(0)}th pct` : 'n/a'}
        </span>
      </div>
      <p className="text-[11px] text-ink-muted leading-relaxed mb-1">{FACTOR_DESCRIPTIONS[factorKey]}</p>
      <div>
        {Object.entries(factor.raw).map(([key, m]) => (
          <MetricRow key={key} metricKey={key} metric={m} />
        ))}
      </div>
    </div>
  )
}

export default function QisFactorScorecard({ loading, error, data }) {
  if (loading) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-6">
        <div className="flex items-center gap-2.5">
          <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-ink-muted/30 border-t-series-1 animate-spin shrink-0" />
          <p className="text-sm text-ink-secondary">Building factor scorecard (fetching sector peers)…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-4 text-sm text-critical">
        Failed to load factor scorecard: {error}
      </div>
    )
  }

  if (!data || !data.sector) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-4 text-sm text-ink-muted">
        No sector classification available for this ticker, so a peer-relative factor scorecard can't be built.
      </div>
    )
  }

  const compositeTone = tierTone(data.composite_score)

  return (
    <div className="border border-hairline rounded-lg bg-surface px-5 py-4">
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-sm font-semibold">QIS Factor Scorecard</p>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Ranked against {data.peer_universe_size} curated large/mid-cap peers in{' '}
            <span className="text-ink-secondary font-medium">{data.sector}</span> (sector ETF {data.sector_etf}) --
            a representative sample, not the full sector or index. The bar under each metric shows where this stock
            sits between the peer set's min and max (tick = sector average); click a row for its implication,
            sector average, and short/medium/long-term read.
          </p>
        </div>
        <div className="text-right shrink-0 ml-4">
          <p className={`text-2xl font-semibold tabular ${TONE_TEXT[compositeTone]}`}>
            {data.composite_score != null ? data.composite_score.toFixed(0) : '—'}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Composite score</p>
        </div>
      </div>

      <div className="space-y-2.5 my-4">
        {FACTOR_ORDER.map((key) => (
          <FactorBar key={key} label={data.factors[key].label} percentile={data.factors[key].percentile} />
        ))}
      </div>

      <div className="space-y-2.5">
        {FACTOR_ORDER.map((key) => (
          <FactorDetail key={key} factorKey={key} factor={data.factors[key]} />
        ))}
      </div>
    </div>
  )
}
