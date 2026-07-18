const LABEL_ORDER = ['Bullish', 'Somewhat-Bullish', 'Neutral', 'Somewhat-Bearish', 'Bearish']

const LABEL_COLORS = {
  Bullish: 'var(--color-good)',
  'Somewhat-Bullish': 'color-mix(in srgb, var(--color-good) 55%, transparent)',
  Neutral: 'var(--color-ink-muted)',
  'Somewhat-Bearish': 'color-mix(in srgb, var(--color-critical) 55%, transparent)',
  Bearish: 'var(--color-critical)',
}

function LabelDistributionBar({ labelCounts }) {
  const max = Math.max(...Object.values(labelCounts), 1)
  return (
    <div className="space-y-2">
      {LABEL_ORDER.map((label) => (
        <div key={label} className="flex items-center gap-3">
          <span className="text-[11px] text-ink-secondary w-32 shrink-0">{label}</span>
          <div className="flex-1 h-3.5 rounded-sm bg-panel overflow-hidden">
            <div
              className="h-full rounded-sm"
              style={{ width: `${(labelCounts[label] / max) * 100}%`, backgroundColor: LABEL_COLORS[label] }}
            />
          </div>
          <span className="text-[11px] font-medium tabular w-6 text-right shrink-0">{labelCounts[label]}</span>
        </div>
      ))}
    </div>
  )
}

function Spinner() {
  return <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-ink-muted/30 border-t-series-1 animate-spin shrink-0" />
}

const PHASE_LABELS = {
  finbert: 'Scoring headlines (FinBERT)',
  llm: 'Scoring with Gemini (LLM)',
}

function StatTile({ label, value, sublabel }) {
  return (
    <div className="border border-hairline rounded-lg bg-panel px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="text-lg font-semibold text-ink tabular mt-0.5">{value}</p>
      {sublabel && <p className="text-[10px] text-ink-muted mt-0.5">{sublabel}</p>}
    </div>
  )
}

export default function SentimentSummaryCard({ loading, error, data, progress }) {
  if (loading) {
    const hasTotal = progress && progress.total > 0
    const pct = hasTotal ? Math.min(100, Math.round((progress.processed / progress.total) * 100)) : null
    const phaseLabel = progress ? PHASE_LABELS[progress.phase] ?? 'Scoring sentiment' : 'Starting sentiment analysis'

    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-6 mb-5">
        <div className="flex items-center gap-2.5">
          <Spinner />
          <p className="text-sm text-ink-secondary">
            {phaseLabel}
            {pct != null ? ` — ${pct}%` : '…'}
          </p>
        </div>

        {hasTotal && (
          <>
            <div className="h-1.5 rounded-full bg-panel overflow-hidden mt-3">
              <div className="h-full rounded-full bg-series-1 transition-all duration-300 ease-out" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[11px] text-ink-muted mt-1.5">{progress.processed} / {progress.total} articles</p>
          </>
        )}

        <p className="text-[11px] text-ink-muted mt-2">This can take up to a minute for larger article sets.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-4 mb-5 text-sm text-critical">
        Sentiment analysis failed: {error}
      </div>
    )
  }

  if (!data || data.summary.articles_scored === 0) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-4 mb-5 text-sm text-ink-muted">
        No articles to score yet.
      </div>
    )
  }

  const { summary, benchmark } = data
  const agreePct = summary.agreement_rate != null ? Math.round(summary.agreement_rate * 100) : null
  const avAgree = benchmark.length ? Math.round((benchmark.filter((b) => b.agree).length / benchmark.length) * 100) : null

  return (
    <div className="border border-hairline rounded-lg bg-surface px-5 py-4 mb-5">
      <p className="text-sm font-semibold mb-2">Sentiment (ticker-specific)</p>

      <div className="text-[11px] text-ink-muted leading-relaxed mb-4 space-y-1.5">
        <p>
          <span className="font-semibold text-ink-secondary">How the overall score is calculated</span> — the
          label distribution below uses the <span className="font-semibold text-ink-secondary">LLM's</span> sentiment
          call alone (Gemini reads the full article and judges tone specifically toward this company), discounted
          by its own relevance judgment: full weight if this company is the article's actual subject
          (<em>Primary</em>), half weight if it's a meaningfully-discussed part of the story (<em>Secondary</em>),
          and zero weight if it's just an incidental reference like a comparison or analogy (<em>Incidental</em>) —
          so a company merely name-dropped in an article about someone else doesn't move its sentiment history.
        </p>
        <p>
          <span className="font-semibold text-ink-secondary">FinBERT ↔ LLM agree</span> — a separate cross-check,
          not part of the score above. A local financial-sentiment model reads just the sentences mentioning this
          ticker (no relevance judgment of its own) and is compared against the LLM's call. A low agreement rate
          doesn't mean either is "wrong" — it flags articles with a genuinely mixed or nuanced tone worth a closer
          look via the conflicting articles, visible per-article in the news table below.
        </p>
        <p>
          <span className="font-semibold text-ink-secondary">vs. Alpha Vantage</span> — how often our combined
          label matches Alpha Vantage's own per-ticker sentiment tag, as an external sanity check, not ground
          truth. In testing, our approach reads as more conservative (defaults to Neutral more often) than AV's —
          so a moderate percentage here mostly reflects that calibration gap, not disagreement on direction:
          genuine opposite-polarity misses were rare (~2% in validation).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        <StatTile label="Articles scored" value={summary.articles_scored} />
        <StatTile
          label="FinBERT ↔ LLM agree"
          value={agreePct != null ? `${agreePct}%` : '—'}
          sublabel={`${summary.conflict_count} conflicting`}
        />
        <StatTile
          label="vs. Alpha Vantage"
          value={avAgree != null ? `${avAgree}%` : 'n/a'}
          sublabel={benchmark.length ? `${benchmark.length} articles benchmarked` : 'no AV articles'}
        />
      </div>

      <LabelDistributionBar labelCounts={summary.label_counts} />
    </div>
  )
}
