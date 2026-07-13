export function Badge({ children, tone = 'neutral', className = '' }) {
  const tones = {
    neutral: 'bg-panel text-ink-secondary',
    good: 'bg-good/15 text-good',
    critical: 'bg-critical/15 text-critical',
    warning: 'bg-warning/15 text-warning',
    accent: 'bg-series-1/15 text-series-1',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function SentimentBadge({ label }) {
  if (!label) return null
  const l = label.toLowerCase()
  let tone = 'neutral'
  if (l.includes('bullish')) tone = 'good'
  else if (l.includes('bearish')) tone = 'critical'
  return <Badge tone={tone}>{label}</Badge>
}
