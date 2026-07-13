import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from './Badge'
import { triggerStageB } from '../lib/api'

function MethodBadge({ method }) {
  const label = method === 'llm' ? 'LLM' : method === 'spacy_fuzzy' ? 'spaCy' : method
  return <Badge tone={method === 'llm' ? 'accent' : 'neutral'}>{label}</Badge>
}

function RelevanceBadge({ relevance }) {
  if (!relevance) return <Badge tone="neutral">n/a</Badge>
  const tone = relevance === 'High' ? 'good' : relevance === 'Medium' ? 'warning' : 'critical'
  return <Badge tone={tone}>{relevance}</Badge>
}

function FilterIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M3 4.5h14l-5.5 6.5v4.5l-3 1.5v-6L3 4.5z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function EntityIcon(props) {
  // Two detector nodes (spaCy, LLM) resolving into one confirmed entity --
  // a visual echo of the noisy-OR combination the ensemble actually does.
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="6" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.6 7.8L11 15M16.4 7.8L13 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="17.5" r="3" fill="currentColor" />
    </svg>
  )
}

const COLUMN_HEADER = (
  <div className="flex items-center gap-3 px-5 py-1.5 border-b border-hairline text-[10px] uppercase tracking-wide text-ink-muted">
    <span className="w-4 shrink-0" />
    <span className="w-16 shrink-0">Ticker</span>
    <span className="flex-1">Company</span>
    <span className="whitespace-nowrap">Mentions</span>
    <span className="w-10 text-right">Conf.</span>
    <span className="w-14 text-right">Relevance</span>
    <span className="w-[88px] text-right">Method</span>
    <span className="w-6 shrink-0" />
  </div>
)

export default function CompanyEntitiesCard({ loading, error, data, idle, activeFilter, onToggleFilter }) {
  const [selected, setSelected] = useState(() => new Set())
  const [triggering, setTriggering] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (data?.candidates) {
      setSelected(new Set(data.candidates.filter((c) => c.default_selected).map((c) => c.ticker)))
    }
  }, [data])

  function toggle(ticker) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(ticker) ? next.delete(ticker) : next.add(ticker)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set((data?.candidates ?? []).map((c) => c.ticker)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  function proceedToStageB() {
    const tickers = (data?.candidates ?? [])
      .filter((c) => selected.has(c.ticker))
      .map((c) => ({ ticker: c.ticker, company_name: c.company_name }))
    if (tickers.length === 0) return

    setTriggering(true)
    triggerStageB(tickers)
      .then(() => navigate('/companies'))
      .catch((err) => {
        setTriggering(false)
        alert(`Failed to start Stage B: ${err.message}`)
      })
  }

  if (loading) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-6 mb-5">
        <p className="text-sm text-ink-secondary">Running NER (spaCy + fuzzy match + Gemini)…</p>
        <p className="text-[11px] text-ink-muted mt-1">This can take up to a minute for larger result sets.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-hairline rounded-lg bg-surface px-5 py-4 mb-5 text-sm text-critical">
        Entity extraction failed: {error}
      </div>
    )
  }

  if (idle) {
    return (
      <div className="border border-hairline rounded-lg bg-surface mb-5 overflow-hidden">
        <div className="px-5 py-4 border-b border-hairline flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-series-1/15 flex items-center justify-center shrink-0">
            <EntityIcon className="w-5 h-5 text-series-1" />
          </div>
          <div>
            <p className="text-sm font-semibold">Companies identified (NER)</p>
            <p className="text-[12px] text-ink-secondary mt-1 leading-relaxed max-w-lg">
              Once you search, every article runs through a spaCy + fuzzy-match pass and Gemini in parallel,
              resolved against SEC EDGAR's company registry. Each candidate comes back with a confidence score,
              a relevance rating, and which method(s) found it — ready to select for Stage B deep ingestion.
            </p>
          </div>
        </div>

        {COLUMN_HEADER}

        <div className="divide-y divide-hairline">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-5 py-2.5 animate-pulse"
              style={{ animationDelay: `${i * 200}ms` }}
            >
              <span className="w-4 h-4 rounded border border-hairline shrink-0" />
              <span className="w-12 h-3 rounded bg-panel shrink-0" />
              <span className="flex-1 h-3 rounded bg-panel max-w-[160px]" />
              <span className="w-14 h-3 rounded bg-panel shrink-0" />
              <span className="w-8 h-3 rounded bg-panel shrink-0" />
              <span className="w-10 h-4 rounded bg-panel shrink-0" />
              <span className="w-16 h-4 rounded bg-panel shrink-0" />
              <span className="w-4 h-4 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!data || data.candidates.length === 0) {
    return null
  }

  const { candidates, articles_total } = data

  return (
    <div className="border border-hairline rounded-lg bg-surface mb-5 overflow-hidden">
      <div className="px-5 py-3 border-b border-hairline flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Companies identified (NER)</p>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {candidates.length} candidates across {articles_total} articles
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={selectAll} className="text-[11px] text-series-1 font-medium hover:underline">
            Select all
          </button>
          <button onClick={clearAll} className="text-[11px] text-ink-muted font-medium hover:underline">
            Clear
          </button>
        </div>
      </div>

      <div className="px-5 py-2.5 border-b border-hairline bg-panel/40 text-[11px] text-ink-muted leading-relaxed">
        <span className="font-semibold text-ink-secondary">Confidence</span> — how certain we are this is the
        correct company. <span className="font-semibold text-ink-secondary">Relevance</span> — whether the
        article actually connects this company to your search topic as a business/investment matter, not just
        whether it's mentioned (e.g. a phone brand named in passing is confidently identified but low relevance).
      </div>

      {COLUMN_HEADER}

      <div className="max-h-72 overflow-y-auto divide-y divide-hairline">
        {candidates.map((c) => {
          const isFiltered = activeFilter === c.ticker
          return (
            <label
              key={c.ticker}
              className={`flex items-center gap-3 px-5 py-2 hover:bg-panel/50 cursor-pointer transition-colors ${
                isFiltered ? 'bg-series-1/10' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(c.ticker)}
                onChange={() => toggle(c.ticker)}
                className="accent-series-1 w-4 h-4 shrink-0"
              />
              <span className="font-mono text-[12px] font-semibold w-16 shrink-0">{c.ticker}</span>
              <span className="text-[13px] text-ink flex-1 truncate">{c.company_name}</span>
              <span className="text-[11px] text-ink-muted tabular whitespace-nowrap">
                {c.mention_count} mention{c.mention_count === 1 ? '' : 's'}
              </span>
              <span className="text-[11px] text-ink-muted tabular whitespace-nowrap w-10 text-right">
                {Math.round(c.best_confidence * 100)}%
              </span>
              <span className="w-14 flex justify-end shrink-0">
                <RelevanceBadge relevance={c.best_relevance} />
              </span>
              <div className="flex gap-1 w-[88px] justify-end shrink-0">
                {c.methods.map((m) => (
                  <MethodBadge key={m} method={m} />
                ))}
              </div>
              <button
                type="button"
                title={isFiltered ? 'Clear filter' : `Show only articles mentioning ${c.ticker}`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onToggleFilter?.(c.ticker)
                }}
                className={`shrink-0 p-1 rounded transition-colors ${
                  isFiltered ? 'text-series-1 bg-series-1/15' : 'text-ink-muted hover:text-ink hover:bg-panel'
                }`}
              >
                <FilterIcon className="w-3.5 h-3.5" />
              </button>
            </label>
          )
        })}
      </div>

      <div className="px-5 py-3 border-t border-hairline flex items-center justify-between">
        <span className="text-[12px] text-ink-secondary">{selected.size} selected</span>
        <button
          onClick={proceedToStageB}
          disabled={selected.size === 0 || triggering}
          className="px-4 py-1.5 rounded-md bg-series-1 text-white text-[12px] font-semibold disabled:opacity-40 hover:bg-series-1/90 transition-colors"
        >
          {triggering ? 'Starting…' : 'Proceed to Stage B →'}
        </button>
      </div>
    </div>
  )
}
