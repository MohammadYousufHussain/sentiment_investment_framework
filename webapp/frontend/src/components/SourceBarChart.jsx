// Fixed source -> color assignment, so a bar's color never shifts when the
// underlying counts (and therefore sort order) change.
const SOURCE_COLORS = {
  alpha_vantage: 'var(--color-series-1)',
  google_news_rss: 'var(--color-series-2)',
  newsapi: 'var(--color-series-3)',
  yahoo_search: 'var(--color-series-4)',
}

export default function SourceBarChart({ counts }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const max = Math.max(...rows.map(([, v]) => v), 1)

  return (
    <div className="space-y-3">
      {rows.map(([source, count]) => (
        <div key={source} className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-ink-secondary w-32 shrink-0 truncate">{source}</span>
          <div className="flex-1 h-4 rounded-sm bg-panel overflow-hidden">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${(count / max) * 100}%`,
                backgroundColor: SOURCE_COLORS[source] ?? 'var(--color-series-5)',
              }}
            />
          </div>
          <span className="text-[12px] font-medium tabular w-10 text-right shrink-0">{count}</span>
        </div>
      ))}
    </div>
  )
}
