const BUCKET_ORDER = ['0-3d', '4-7d', '8-14d', '15-30d', '30d+']

// Sequential, one hue, light -> dark -- these are ordinal age buckets
// (magnitude / recency), not distinct categories, so a single ramp is the
// right encoding rather than the categorical palette.
const BUCKET_OPACITY = { '0-3d': 1, '4-7d': 0.8, '8-14d': 0.6, '15-30d': 0.4, '30d+': 0.25 }

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function TimeCoverageBar({ histogram, earliest, latest }) {
  const total = Object.values(histogram).reduce((a, b) => a + b, 0)
  if (total === 0) return null

  const recentShare = Math.round(((histogram['0-3d'] ?? 0) / total) * 100)

  return (
    <div className="border border-hairline rounded-lg bg-surface px-5 py-4 mb-5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold">News coverage over time</p>
        <span className="text-[11px] text-ink-muted tabular">
          {formatDate(earliest)} – {formatDate(latest)}
        </span>
      </div>
      <p className="text-[11px] text-ink-muted mb-3 leading-relaxed">
        {recentShare}% of articles are from the last 3 days. A daily sentiment time series will be dense and
        reliable for recent days, but sparse (few articles per day) further back — worth knowing before reading
        too much into any single older day's trend.
      </p>

      <div className="flex items-end gap-2 mt-1">
        {BUCKET_ORDER.map((bucket) => {
          const count = histogram[bucket] ?? 0
          const maxCount = Math.max(...BUCKET_ORDER.map((b) => histogram[b] ?? 0), 1)
          const heightPct = (count / maxCount) * 100
          return (
            <div key={bucket} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex items-end h-20">
                <div
                  className="w-full rounded-sm bg-series-1"
                  style={{ height: `${Math.max(heightPct, count > 0 ? 6 : 0)}%`, opacity: BUCKET_OPACITY[bucket] }}
                />
              </div>
              <span className="text-[10px] text-ink-muted whitespace-nowrap">{bucket}</span>
              <span className="text-[11px] font-medium tabular text-ink-secondary">{count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
