import { useRef, useState } from 'react'
import { getLockedMetricWeights, lockMetricWeights } from '../lib/weightsStore'

const FACTOR_ORDER = ['value', 'quality', 'growth', 'momentum']

const FACTOR_DESCRIPTIONS = {
  value: 'Cheapness relative to earnings, EBITDA, cash generation, and book value -- vs. this company’s own trailing history, not peers.',
  quality: 'Profitability, capital efficiency, and balance-sheet strength, tracked over its own reporting history.',
  growth: 'Revenue and earnings expansion vs. this company’s own trend, not an absolute or peer-relative bar.',
  momentum: 'Vol-adjusted 12-month price trend (skipping the most recent month), vs. its own rolling history.',
}

const PERCENT_METRICS = new Set(['fcf_yield', 'operating_margin', 'return_on_equity', 'revenue_growth', 'eps_growth'])
const MULTIPLE_METRICS = new Set(['trailing_pe', 'ev_to_ebitda', 'price_to_book', 'debt_to_equity', 'cash_conversion'])

function formatMetric(key, value) {
  if (value == null) return '—'
  if (PERCENT_METRICS.has(key)) return `${(value * 100).toFixed(1)}%`
  if (MULTIPLE_METRICS.has(key)) return `${value.toFixed(2)}x`
  return value.toFixed(2)
}

// Standard normal CDF (Abramowitz & Stegun 26.2.17 approximation) -- used
// only to map a z-score onto a familiar 0-100 "score" for the bars below.
// The actual math (combining metrics into a factor, factors into a
// composite) always happens on the underlying z-scores, never on these
// post-transform 0-100 numbers, since averaging percentiles isn't the same
// as averaging the z-scores that produced them.
function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  if (z > 0) prob = 1 - prob
  return prob
}

function weightedZ(entries) {
  const valid = entries.filter((e) => e.z != null && e.w > 0)
  if (!valid.length) return null
  const totalW = valid.reduce((s, e) => s + e.w, 0)
  return valid.reduce((s, e) => s + e.z * e.w, 0) / totalW
}

function equalWeights(keys) {
  const share = Math.round((100 / keys.length) * 10) / 10
  return Object.fromEntries(keys.map((k) => [k, share]))
}

// Editing one weight proportionally rescales the rest so the group always
// sums to exactly 100 -- the standard "budget allocator" pattern, so a
// weight reads directly as "this metric is 25% of the factor's score"
// rather than an arbitrary coefficient the user has to mentally normalize.
function rebalance(weights, keys, changedKey, newValue) {
  const clamped = Math.round(Math.min(100, Math.max(0, newValue)) * 10) / 10
  const others = keys.filter((k) => k !== changedKey)
  const next = { ...weights, [changedKey]: clamped }
  if (!others.length) return next
  const oldOthersSum = others.reduce((s, k) => s + (weights[k] ?? 0), 0)
  const remaining = Math.round((100 - clamped) * 10) / 10
  if (oldOthersSum > 1e-9) {
    others.forEach((k) => {
      next[k] = Math.round(((weights[k] ?? 0) / oldOthersSum) * remaining * 10) / 10
    })
  } else {
    const share = Math.round((remaining / others.length) * 10) / 10
    others.forEach((k) => { next[k] = share })
  }
  return next
}

function zTone(z) {
  if (z == null) return 'neutral'
  if (z >= 0.5) return 'good'
  if (z <= -0.5) return 'critical'
  return 'accent'
}

// Picks a Y-axis range from the 10th-90th percentile core of the data, with
// generous (1.5x core-range) headroom before clamping -- wide enough that
// ordinary quarter-to-quarter variation is never clipped, tight enough that
// a growth-rate spike from a near-zero comparison base (which can run into
// the thousands of percent) doesn't compress every other, more typical
// quarter into a flat, unreadable line near one edge.
function axisBounds(vals) {
  const sorted = [...vals].sort((a, b) => a - b)
  const n = sorted.length
  const pct = (p) => {
    const idx = (n - 1) * p
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
  }
  if (n < 8) return [sorted[0], sorted[n - 1]]
  const coreLo = pct(0.1)
  const coreHi = pct(0.9)
  const coreRange = coreHi - coreLo || Math.abs(coreHi) || 1
  return [Math.max(sorted[0], coreLo - coreRange * 1.5), Math.min(sorted[n - 1], coreHi + coreRange * 1.5)]
}

const TONE_BAR = { good: 'bg-good', accent: 'bg-series-1', critical: 'bg-critical', neutral: 'bg-ink-muted' }
const TONE_TEXT = { good: 'text-good', accent: 'text-series-1', critical: 'text-critical', neutral: 'text-ink-muted' }

function WeightInput({ value, onChange, title }) {
  return (
    <span className="flex items-center gap-0.5">
      <input
        type="number"
        step="1"
        min="0"
        max="100"
        value={value}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value)
          onChange(Number.isFinite(parsed) ? Math.max(0, parsed) : 0)
        }}
        onClick={(e) => e.stopPropagation()}
        title={title}
        className="w-12 px-1 py-0.5 text-[11px] rounded border border-hairline bg-panel text-ink tabular text-right
                   focus:outline-none focus:ring-1 focus:ring-series-1/50"
      />
      <span className="text-[10px] text-ink-muted">%</span>
    </span>
  )
}

function FactorBar({ label, z, weight, onWeightChange }) {
  const score = z != null ? normalCdf(z) * 100 : null
  const tone = zTone(z)
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] font-medium text-ink-secondary w-20 shrink-0">{label}</span>
      <div className="flex-1 h-3.5 rounded-sm bg-panel overflow-hidden">
        <div className={`h-full rounded-sm ${TONE_BAR[tone]}`} style={{ width: `${score ?? 0}%` }} />
      </div>
      <span className={`text-[12px] font-semibold tabular w-14 text-right shrink-0 ${TONE_TEXT[tone]}`}>
        {score != null ? score.toFixed(0) : 'n/a'}
      </span>
      <WeightInput value={weight} onChange={onWeightChange} title="Weight in the overall composite score" />
    </div>
  )
}

// Compact sparkline: solid line = raw quarterly reading, dashed muted line =
// the trailing 12-quarter moving average ("normalized"). Seeing both on one
// chart is the point -- how far and how often the solid line strays from
// the dashed one IS the cyclicality story. Hovering shows the exact period,
// actual value, and 12Q-average value via a crosshair + floating tooltip.
function MetricChart({ chart, metricKey }) {
  const svgRef = useRef(null)
  const [hoverIndex, setHoverIndex] = useState(null)
  const { periods, values, ma } = chart
  if (!periods.length) return null

  const allVals = [...values, ...ma].filter((v) => v != null)
  if (allVals.length < 2) return null
  const [dataMin, dataMax] = axisBounds(allVals)
  const range = dataMax - dataMin || Math.abs(dataMax) || 1
  const pad = range * 0.12
  const yMin = dataMin - pad
  const yMax = dataMax + pad

  const width = 100
  const height = 30
  const xStep = periods.length > 1 ? width / (periods.length - 1) : 0
  const xFor = (i) => i * xStep
  // Clamp to the visible range rather than extending the scale to fit --
  // a growth-rate metric with a near-zero comparison base can spike to an
  // extreme reading in 1-2 quarters that would otherwise flatten every
  // other, more typical quarter into an unreadable line near one edge.
  const yFor = (v) => height - ((Math.min(Math.max(v, yMin), yMax) - yMin) / (yMax - yMin)) * height

  const toPoints = (series) => series.map((v, i) => (v != null ? `${xFor(i)},${yFor(v)}` : null)).filter(Boolean).join(' ')
  const rawPoints = toPoints(values)
  const maPoints = toPoints(ma)

  function handleMove(e) {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const idx = Math.round(relX * (periods.length - 1))
    setHoverIndex(Math.max(0, Math.min(periods.length - 1, idx)))
  }

  const hoverPct = hoverIndex != null ? (xFor(hoverIndex) / width) * 100 : null
  // Keep the tooltip from running off either edge of the chart.
  const tooltipTransform = hoverPct == null ? '' : hoverPct < 15 ? 'translateX(0%)' : hoverPct > 85 ? 'translateX(-100%)' : 'translateX(-50%)'
  const tooltipLeft = hoverPct == null ? 0 : hoverPct < 15 ? 0 : hoverPct > 85 ? 100 : hoverPct

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-14 cursor-crosshair"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {maPoints && (
          <polyline points={maPoints} fill="none" stroke="var(--color-ink-muted)" strokeWidth="1.5"
                     strokeDasharray="3,2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        )}
        {rawPoints && (
          <polyline points={rawPoints} fill="none" stroke="var(--color-series-1)" strokeWidth="2"
                     strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        )}
        {hoverIndex != null && (
          <>
            <line x1={xFor(hoverIndex)} x2={xFor(hoverIndex)} y1={0} y2={height}
                  stroke="var(--color-hairline)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {values[hoverIndex] != null && (
              <circle cx={xFor(hoverIndex)} cy={yFor(values[hoverIndex])} r="3.5" fill="var(--color-series-1)"
                      stroke="var(--color-surface)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            )}
            {ma[hoverIndex] != null && (
              <circle cx={xFor(hoverIndex)} cy={yFor(ma[hoverIndex])} r="3" fill="var(--color-ink-muted)"
                      stroke="var(--color-surface)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            )}
          </>
        )}
      </svg>

      {hoverIndex != null && (
        <div
          className="absolute -top-1 z-10 pointer-events-none border border-hairline rounded-md bg-surface px-2 py-1.5 shadow-lg whitespace-nowrap"
          style={{ left: `${tooltipLeft}%`, transform: `${tooltipTransform} translateY(-100%)` }}
        >
          <p className="text-[10px] font-medium text-ink-secondary">{periods[hoverIndex]}</p>
          <p className="text-[11px] text-series-1 font-medium">actual: {formatMetric(metricKey, values[hoverIndex])}</p>
          <p className="text-[11px] text-ink-muted">12Q avg: {formatMetric(metricKey, ma[hoverIndex])}</p>
        </div>
      )}
      <div className="flex justify-between items-center text-[9px] text-ink-muted mt-0.5">
        <span>{periods[0]}</span>
        <span className="flex items-center gap-2.5">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-series-1 inline-block" />actual</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-ink-muted inline-block" />12Q avg</span>
        </span>
        <span>{periods[periods.length - 1]}</span>
      </div>
    </div>
  )
}

function StatCell({ label, value, tone, title }) {
  return (
    <div className="relative border border-hairline rounded-md bg-surface px-2 py-1.5 group/stat">
      <p className="text-[9px] uppercase tracking-wide text-ink-muted leading-tight">{label}</p>
      <p className={`text-[12px] font-semibold tabular mt-0.5 ${tone ? TONE_TEXT[tone] : 'text-ink'}`}>{value}</p>
      {title && (
        <div
          className="pointer-events-none absolute left-0 bottom-full mb-1.5 w-52 rounded-md border border-hairline
                     bg-surface px-2.5 py-1.5 text-[10px] leading-relaxed text-ink-secondary shadow-lg opacity-0
                     invisible group-hover/stat:opacity-100 group-hover/stat:visible transition-opacity z-10"
        >
          {title}
        </div>
      )}
    </div>
  )
}

function MetricRow({ metricKey, metric, weight, onWeightChange }) {
  const [expanded, setExpanded] = useState(false)
  const tone = zTone(metric.zscore)
  const devPct = metric.deviation_from_normalized != null ? metric.deviation_from_normalized * 100 : null
  const devLarge = devPct != null && Math.abs(devPct) >= 50
  const devTone = metric.favorable == null ? 'neutral' : metric.favorable ? 'good' : 'critical'
  const devTitle =
    devPct == null
      ? undefined
      : `${devPct >= 0 ? 'Above' : 'Below'} its own 12-quarter average -- ${metric.favorable ? 'favorable' : 'adverse'}` +
        ` given ${metric.label} is ${metric.direction === 1 ? 'higher-is-better' : 'lower-is-better'}.` +
        (devLarge
          ? ' This is a large deviation -- for a genuinely cyclical company, an especially favorable-looking reading can itself be a warning sign (check the Stability score).'
          : '')

  return (
    <div className="border-t border-hairline first:border-t-0 py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-[12px] font-medium text-ink-secondary">{metric.label}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[11px] font-semibold tabular ${TONE_TEXT[tone]}`}>
            {metric.zscore != null ? `z ${metric.zscore >= 0 ? '+' : ''}${metric.zscore.toFixed(2)}` : 'n/a'}
          </span>
          <WeightInput value={weight} onChange={onWeightChange} title="Weight in this factor's score" />
        </div>
      </div>

      <MetricChart chart={metric.chart} metricKey={metricKey} />

      <div className="grid grid-cols-4 gap-2 mt-2.5">
        <StatCell label="Current" value={formatMetric(metricKey, metric.current)} />
        <StatCell label="Normalized (12Q avg)" value={formatMetric(metricKey, metric.normalized)} />
        <StatCell
          label="Stability (CoV)"
          value={metric.stability != null ? metric.stability.toFixed(2) : '—'}
          title="Coefficient of Variation = standard deviation / mean over the trailing 12 quarters. Lower = more stable/predictable; higher = more cyclical/volatile."
        />
        <StatCell
          label="Deviation from Normalized"
          value={devPct != null ? `${devPct >= 0 ? '+' : ''}${devPct.toFixed(0)}%` : '—'}
          tone={devTone}
          title={devTitle}
        />
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-[10px] text-ink-muted hover:text-ink-secondary mt-2 cursor-pointer"
      >
        {expanded ? '▲ hide explanation' : '▼ what does this mean'}
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1">
          {metric.implication && <p className="text-[11px] text-ink-muted leading-relaxed">{metric.implication}</p>}
          <p className="text-[10px] text-ink-muted">
            {metric.history_count} historical observations{metric.as_of ? ` · data as of ${metric.as_of}` : ''}. z-score
            = deviation from normalized ÷ stability -- how many of this metric's own typical swings away today's
            reading is, direction-adjusted so positive always means favorable.
          </p>
        </div>
      )}
    </div>
  )
}

function FactorDetail({ factorKey, factor, factorZ, weights, onWeightChange }) {
  const tone = zTone(factorZ)
  const factorScore = factorZ != null ? normalCdf(factorZ) * 100 : null
  return (
    <div className="border border-hairline rounded-lg bg-panel px-4 py-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-semibold text-ink">{factor.label}</span>
        <span className={`text-[11px] font-semibold tabular ${TONE_TEXT[tone]}`}>
          {factorScore != null ? `${factorScore.toFixed(0)} (z ${factorZ >= 0 ? '+' : ''}${factorZ.toFixed(2)})` : 'n/a'}
        </span>
      </div>
      <p className="text-[11px] text-ink-muted leading-relaxed mb-1">{FACTOR_DESCRIPTIONS[factorKey]}</p>
      <div>
        {Object.entries(factor.raw).map(([key, m]) => (
          <MetricRow
            key={key}
            metricKey={key}
            metric={m}
            weight={weights[key] ?? 0}
            onWeightChange={(v) => onWeightChange(key, v)}
          />
        ))}
      </div>
    </div>
  )
}

export default function HistoricalFactorScorecard({ loading, error, data }) {
  // Seeded once from whatever was last locked here (see lib/weightsStore.js)
  // -- if nothing's ever been locked, starts empty and falls through to the
  // equal-weight seeding below, same as before.
  const [metricWeights, setMetricWeights] = useState(() => getLockedMetricWeights() || {})
  const [factorWeights, setFactorWeights] = useState({})
  const [justLocked, setJustLocked] = useState(false)

  if (loading) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-6">
        <div className="flex items-center gap-2.5">
          <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-ink-muted/30 border-t-series-1 animate-spin shrink-0" />
          <p className="text-sm text-ink-secondary">Building historical factor scorecard…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-4 text-sm text-critical">
        Failed to load historical scorecard: {error}
      </div>
    )
  }

  if (!data) return null

  // Lazily seed an equal-percentage split (summing to 100) the first time
  // each factor's metric group is rendered; once the user edits anything,
  // their values persist in state (including across a ticker switch, since
  // the weighting scheme is a user preference, not per-ticker).
  const seededMetricWeights = { ...metricWeights }
  for (const key of FACTOR_ORDER) {
    if (!seededMetricWeights[key]) {
      seededMetricWeights[key] = equalWeights(Object.keys(data.factors[key].raw))
    }
  }
  const seededFactorWeights = Object.keys(factorWeights).length ? factorWeights : equalWeights(FACTOR_ORDER)

  function setMetricWeight(factorKey, metricKey, value) {
    setMetricWeights((prev) => {
      const current = prev[factorKey] || seededMetricWeights[factorKey]
      const keys = Object.keys(data.factors[factorKey].raw)
      return { ...prev, [factorKey]: rebalance(current, keys, metricKey, value) }
    })
  }
  function setFactorWeight(factorKey, value) {
    setFactorWeights((prev) => {
      const current = Object.keys(prev).length ? prev : seededFactorWeights
      return rebalance(current, FACTOR_ORDER, factorKey, value)
    })
  }
  function handleLock() {
    lockMetricWeights(seededMetricWeights)
    setJustLocked(true)
    setTimeout(() => setJustLocked(false), 2000)
  }

  const factorZs = {}
  for (const key of FACTOR_ORDER) {
    const weights = seededMetricWeights[key]
    const entries = Object.entries(data.factors[key].raw).map(([mKey, m]) => ({ z: m.zscore, w: weights[mKey] ?? 0 }))
    factorZs[key] = weightedZ(entries)
  }

  const compositeEntries = FACTOR_ORDER.map((key) => ({ z: factorZs[key], w: seededFactorWeights[key] ?? 0 }))
  const compositeZ = weightedZ(compositeEntries)
  const compositeScore = compositeZ != null ? normalCdf(compositeZ) * 100 : null
  const compositeTone = zTone(compositeZ)

  return (
    <div className="border border-hairline rounded-lg bg-surface px-5 py-4">
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-sm font-semibold">Historical Factor Scorecard</p>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Each metric is scored as a z-score against this company's OWN trailing 12-quarter distribution (not a
            peer set -- that view lives on the Comparables tab), so it directly answers "is today's reading unusual
            for THIS company," scaled by how much this specific metric normally moves. The number next to each
            metric/factor is that z-score mapped onto a familiar 0-100 scale purely for the bar visual; the
            underlying combination always happens on the z-scores themselves. Every weight field below defaults
            to an equal split (each group always sums to 100%) -- editing one proportionally rescales the rest, and
            the score recomputes live.
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
          <button
            onClick={handleLock}
            title="Carry these per-metric weights forward to the Integrated Scoring and Comparables tabs"
            className={`text-[10px] font-medium cursor-pointer mt-1 ${justLocked ? 'text-good' : 'text-ink-muted hover:text-ink-secondary'}`}
          >
            {justLocked ? '✓ Locked' : '🔒 Lock weights'}
          </button>
        </div>
      </div>

      <div className="space-y-2.5 my-4">
        {FACTOR_ORDER.map((key) => (
          <FactorBar
            key={key}
            label={data.factors[key].label}
            z={factorZs[key]}
            weight={seededFactorWeights[key] ?? 0}
            onWeightChange={(v) => setFactorWeight(key, v)}
          />
        ))}
      </div>

      <div className="space-y-2.5">
        {FACTOR_ORDER.map((key) => (
          <FactorDetail
            key={key}
            factorKey={key}
            factor={data.factors[key]}
            factorZ={factorZs[key]}
            weights={seededMetricWeights[key]}
            onWeightChange={(metricKey, v) => setMetricWeight(key, metricKey, v)}
          />
        ))}
      </div>
    </div>
  )
}
