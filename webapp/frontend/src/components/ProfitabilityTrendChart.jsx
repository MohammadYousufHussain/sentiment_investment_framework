const METRICS = [
  { key: 'revenue_growth', label: 'Revenue Growth (YoY)', color: 'var(--color-series-1)' },
  { key: 'gross_margin', label: 'Gross Margin', color: 'var(--color-series-2)' },
  { key: 'operating_margin', label: 'Operating Margin', color: 'var(--color-series-3)' },
  { key: 'net_margin', label: 'Net Margin', color: 'var(--color-series-4)' },
]

function formatPeriodLabel(fiscalDate, period) {
  if (!fiscalDate) return ''
  const [year, month] = fiscalDate.split('-')
  if (period === 'annual') return year
  const quarter = Math.ceil(Number(month) / 3)
  return `Q${quarter} '${year.slice(2)}`
}

export function formatPct(v) {
  if (v == null) return '—'
  return `${(v * 100).toFixed(1)}%`
}

export { METRICS }

export default function ProfitabilityTrendChart({ periods, period }) {
  if (!periods.length) return null

  const allValues = periods.flatMap((p) => METRICS.map((m) => p[m.key]).filter((v) => v != null))
  const dataMin = Math.min(0, ...allValues)
  const dataMax = Math.max(0, ...allValues)
  const range = dataMax - dataMin || 1
  const pad = range * 0.15
  const yMin = dataMin - pad
  const yMax = dataMax + pad

  const width = 100
  const height = 40
  const xStep = periods.length > 1 ? width / (periods.length - 1) : 0

  const xFor = (i) => i * xStep
  const yFor = (v) => height - ((v - yMin) / (yMax - yMin)) * height
  const zeroY = yFor(0)

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-40">
        <line
          x1={0} x2={width} y1={zeroY} y2={zeroY}
          stroke="var(--color-hairline)" strokeWidth="1" vectorEffect="non-scaling-stroke"
        />
        {METRICS.map((m) => {
          const points = periods
            .map((p, i) => (p[m.key] != null ? `${xFor(i)},${yFor(p[m.key])}` : null))
            .filter(Boolean)
            .join(' ')
          if (!points) return null
          return (
            <polyline
              key={m.key}
              points={points}
              fill="none"
              stroke={m.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>

      <div className="flex justify-between text-[10px] text-ink-muted mt-1 px-0.5">
        {periods.map((p, i) => (
          <span key={i}>{formatPeriodLabel(p.fiscal_date, period)}</span>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
        {METRICS.map((m) => (
          <div key={m.key} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
            {m.label}
          </div>
        ))}
      </div>
    </div>
  )
}
