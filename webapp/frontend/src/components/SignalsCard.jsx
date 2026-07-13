import { Badge } from './Badge'

const WINDOW_LABELS = { recent: 'Recent (0-3 days)', mid: 'Mid (4-14 days)', historical: 'Historical (15-30+ days)' }

// Same -2..+2 rank scale the pipeline scores articles on (src/sentiment/ensemble.py
// LABEL_RANK) -- banded at the midpoints between adjacent integer ranks so a
// window's continuous mean_rank reads as the label it's closest to.
function rankLabel(v) {
  if (v >= 1.5) return 'Bullish'
  if (v >= 0.5) return 'Somewhat Bullish'
  if (v > -0.5) return 'Neutral'
  if (v > -1.5) return 'Somewhat Bearish'
  return 'Bearish'
}

function rankTone(v) {
  if (v >= 0.5) return 'text-good'
  if (v <= -0.5) return 'text-critical'
  return 'text-ink-muted'
}

const SCALE_GRADIENT = { background: 'linear-gradient(to right, var(--color-critical), var(--color-ink-muted) 50%, var(--color-good))' }

function SentimentScaleLegend() {
  return (
    <div className="mb-3">
      <div className="h-1.5 rounded-full" style={SCALE_GRADIENT} />
      <div className="flex justify-between text-[10px] text-ink-muted mt-1">
        <span className="text-critical font-medium">Bearish (-2)</span>
        <span>Neutral (0)</span>
        <span className="text-good font-medium">Bullish (+2)</span>
      </div>
    </div>
  )
}

function MiniScale({ value }) {
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

const SIGNAL_COPY = {
  sharp_inflection: (s) => `Sharp inflection ${s.direction === 'up' ? '↑' : '↓'} (Δ${s.delta > 0 ? '+' : ''}${s.delta})`,
  sustained_positivity: () => 'Sustained positivity',
  sustained_negativity: () => 'Sustained negativity',
  negative_to_positive_turnaround: () => 'Negative → positive turnaround',
  positive_to_negative_turnaround: () => 'Positive → negative turnaround',
}

// The full catalog the pipeline can detect (src/signals/detectors.py) -- shown
// as a reference legend regardless of what fires for this particular ticker,
// so it's clear what "no signals detected" is being compared against.
const SIGNAL_CATALOG = [
  { type: 'sharp_inflection', label: 'Sharp inflection (spike)', description: 'A full category jump in mean sentiment between the recent and mid windows, in either direction.' },
  { type: 'sustained_positivity', label: 'Sustained positivity', description: 'Recent and mid windows both average solidly positive -- a positive view holding steady, not a one-window blip.' },
  { type: 'sustained_negativity', label: 'Sustained negativity', description: 'Recent and mid windows both average solidly negative.' },
  { type: 'negative_to_positive_turnaround', label: 'Negative → positive turnaround', description: 'Mid window was solidly negative; recent window has flipped solidly positive.' },
  { type: 'positive_to_negative_turnaround', label: 'Positive → negative turnaround', description: 'Mid window was solidly positive; recent window has flipped solidly negative.' },
]

const RELIABILITY_EXPLANATION = {
  Strong: 'Both windows being compared have 10+ articles each — the trend is backed by a solid sample on both sides.',
  Moderate: 'Both windows being compared have 5-9 articles each — enough to trust the direction, but a thinner sample than Strong.',
  Weak: 'At least one window being compared has fewer than 5 articles (but at least 3, the minimum to be used at all) — treat the direction as tentative.',
}

function ReliabilityBadge({ reliability }) {
  const tone = reliability === 'Strong' ? 'good' : reliability === 'Moderate' ? 'warning' : 'neutral'
  return (
    <span className="relative inline-flex group/reliability">
      <Badge tone={tone}>{reliability}</Badge>
      <span
        className="pointer-events-none absolute right-0 bottom-full mb-1.5 w-56 rounded-md border border-hairline
                   bg-surface px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-secondary shadow-lg opacity-0
                   invisible group-hover/reliability:opacity-100 group-hover/reliability:visible transition-opacity z-10"
      >
        {RELIABILITY_EXPLANATION[reliability]}
      </span>
    </span>
  )
}

function WindowTile({ name, stats }) {
  return (
    <div className="border border-hairline rounded-lg bg-panel px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-ink-muted">{WINDOW_LABELS[name]}</p>
      {stats.insufficient_data ? (
        <p className="text-[12px] text-ink-muted mt-1">Insufficient data ({stats.count} article{stats.count === 1 ? '' : 's'})</p>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <p className="text-lg font-semibold text-ink tabular">{stats.mean_rank > 0 ? '+' : ''}{stats.mean_rank}</p>
            <span className={`text-[11px] font-medium ${rankTone(stats.mean_rank)}`}>{rankLabel(stats.mean_rank)}</span>
          </div>
          <MiniScale value={stats.mean_rank} />
          <p className="text-[10px] text-ink-muted mt-1.5">{stats.count} articles</p>
        </>
      )}
    </div>
  )
}

export default function SignalsCard({ loading, error, data }) {
  if (loading) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-6 mb-5">
        <p className="text-sm text-ink-secondary">Analyzing signals…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-4 mb-5 text-sm text-critical">
        Signal detection failed: {error}
      </div>
    )
  }

  if (!data || data.articles_scored === 0) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-4 mb-5 text-sm text-ink-muted">
        No scored articles yet — signals will appear once sentiment analysis completes.
      </div>
    )
  }

  const { windows, signals } = data

  return (
    <div className="border border-hairline rounded-lg bg-surface px-5 py-4 mb-5">
      <p className="text-sm font-semibold mb-2">Signals</p>
      <p className="text-[11px] text-ink-muted leading-relaxed mb-4">
        The same confidence-weighted mean sentiment score, computed separately over three non-overlapping time
        periods (not a single trend line) so a shift between them can be read as a signal. Each score sits on a
        -2 to +2 scale running from Bearish through Neutral to Bullish. A window with fewer than 3 articles is
        marked insufficient rather than used — see the reliability tag on each signal below, which reflects how
        much data actually backs it (Strong ≥10 articles per window compared, Moderate 5-9, Weak below that but
        still above the minimum).
      </p>

      <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1.5">Sentiment scale</p>
      <SentimentScaleLegend />

      <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-2">Time periods compared</p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {['recent', 'mid', 'historical'].map((name) => (
          <WindowTile key={name} name={name} stats={windows[name]} />
        ))}
      </div>

      {signals.length === 0 && (
        <p className="text-[12px] text-ink-muted mb-3">No signals detected — sentiment is stable across windows or data is too thin to compare.</p>
      )}

      <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-2">Signal types tracked</p>
      <div className="space-y-2">
        {SIGNAL_CATALOG.map((cat) => {
          const active = signals.find((s) => s.type === cat.type)
          return (
            <div
              key={cat.type}
              className={`flex items-center justify-between gap-3 border rounded-md px-3 py-2 ${
                active ? 'border-series-1/50 bg-series-1/10' : 'border-hairline/50 bg-panel/30'
              }`}
            >
              <div className="min-w-0">
                <span className={`text-[13px] font-medium ${active ? 'text-ink' : 'text-ink-muted'}`}>
                  {active ? SIGNAL_COPY[active.type]?.(active) ?? cat.label : cat.label}
                </span>
                <p className="text-[11px] text-ink-muted mt-0.5">{cat.description}</p>
              </div>
              {active ? (
                <ReliabilityBadge reliability={active.reliability} />
              ) : (
                <span className="text-[11px] text-ink-muted whitespace-nowrap shrink-0">not detected</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
