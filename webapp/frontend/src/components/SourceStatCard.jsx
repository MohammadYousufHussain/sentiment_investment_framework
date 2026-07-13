const STATUS_STYLES = {
  pending: { dot: 'bg-ink-muted', label: 'queued' },
  loading: { dot: 'bg-series-1 animate-pulse', label: 'fetching…' },
  success: { dot: 'bg-good', label: 'done' },
  error: { dot: 'bg-critical', label: 'error' },
}

export default function SourceStatCard({ name, status, fetched, newCount, error }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.pending
  return (
    <div className="flex-1 min-w-[150px] rounded-lg border border-hairline bg-surface px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[11px] text-ink-secondary truncate">{name}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      </div>
      {status === 'success' ? (
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular">{fetched}</span>
          <span className="text-[11px] text-ink-muted">fetched</span>
          {newCount > 0 && (
            <span className="text-[11px] font-medium text-good tabular ml-auto">+{newCount} new</span>
          )}
        </div>
      ) : status === 'error' ? (
        <p className="text-[11px] text-critical truncate" title={error}>{error || 'failed'}</p>
      ) : (
        <p className="text-[11px] text-ink-muted">{s.label}</p>
      )}
    </div>
  )
}
