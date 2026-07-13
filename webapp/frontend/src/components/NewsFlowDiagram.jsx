const SOURCES = ['Google News', 'NewsAPI', 'Alpha Vantage', 'Yahoo Finance']
const SAMPLE_TICKERS = ['AAPL', 'TSLA', 'NVDA']
const NER_STEPS = [
  { label: 'Extraction', sublabel: 'spaCy + fuzzy match + Gemini find candidate companies' },
  { label: 'Confidence', sublabel: 'how certain we are this is the correct company' },
  { label: 'Relevance', sublabel: 'whether it actually matters for this search topic' },
]
// Kept in sync with the literal "3.6s" in the Tailwind arbitrary-value class
// below -- Tailwind needs a static string to generate the utility, so it
// can't be interpolated from this constant.
const STEP_CYCLE_SECONDS = 3.6

function SourcePill({ label, delay, compact }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full border border-hairline bg-surface ${compact ? 'px-2 py-1' : 'px-3 py-1.5'}`}>
      <span
        className="w-1.5 h-1.5 rounded-full bg-series-1 shrink-0 motion-safe:animate-[node-pulse_2.4s_ease-in-out_infinite]"
        style={{ animationDelay: `${delay}s` }}
      />
      <span className={`text-ink-secondary whitespace-nowrap ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{label}</span>
    </div>
  )
}

function FlowConnector({ compact }) {
  if (compact) {
    return (
      <svg viewBox="0 0 16 10" className="w-4 h-2.5 text-ink-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M1 5h11M8 1.5l4 3.5-4 3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <div className="relative flex justify-center w-px h-6">
      <span className="absolute top-0 bottom-0 w-px bg-hairline" />
      {[0, 0.6, 1.2].map((d) => (
        <span
          key={d}
          className="absolute w-1 h-1 rounded-full bg-series-1 motion-safe:animate-[flow-down_1.8s_ease-in-out_infinite]"
          style={{ animationDelay: `${d}s` }}
        />
      ))}
    </div>
  )
}

function StageBadge({ label, sublabel, compact }) {
  return (
    <div className={`rounded-lg border border-hairline bg-panel text-center ${compact ? 'px-2.5 py-1' : 'px-4 py-2'}`}>
      <p className={`font-semibold text-ink whitespace-nowrap ${compact ? 'text-[10px]' : 'text-[12px]'}`}>{label}</p>
      {sublabel && !compact && <p className="text-[10px] text-ink-muted mt-0.5 whitespace-nowrap">{sublabel}</p>}
    </div>
  )
}

function NerEngineGroup({ compact }) {
  if (compact) {
    return <StageBadge label="NER" compact />
  }
  return (
    <div className="rounded-lg border border-hairline px-4 py-3 w-72">
      <p className="text-[10px] uppercase tracking-wide text-ink-muted text-center mb-2.5">NER Engine</p>
      <div className="flex flex-col gap-1.5">
        {NER_STEPS.map((step, i) => (
          <div key={step.label}>
            <div
              className="rounded-md border px-3 py-2 motion-safe:animate-[step-glow_3.6s_ease-in-out_infinite]"
              style={{ animationDelay: `${i * (STEP_CYCLE_SECONDS / NER_STEPS.length)}s` }}
            >
              <p className="text-[11px] font-semibold text-ink">{step.label}</p>
              <p className="text-[10px] text-ink-muted mt-0.5 leading-snug">{step.sublabel}</p>
            </div>
            {i < NER_STEPS.length - 1 && (
              <div className="flex justify-center py-0.5">
                <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M2 2l3 4 3-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TickerChip({ ticker, delay, compact }) {
  return (
    <span
      className={`font-mono font-semibold rounded border border-series-1/30 bg-series-1/10 text-series-1 motion-safe:animate-[chip-cycle_4.5s_ease-in-out_infinite] ${
        compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-1'
      }`}
      style={{ animationDelay: `${delay}s` }}
    >
      {ticker}
    </span>
  )
}

/**
 * Illustrates the Stage A -> NER concept, top to bottom: many sources feed a
 * shared article pool, which the NER ensemble scans in three real sub-steps
 * (extraction, confidence scoring, relevance scoring) to surface candidate
 * tickers. Purely decorative/explanatory -- no live data. `compact` renders a
 * smaller horizontal version for use as a footer once real results are on screen.
 */
export default function NewsFlowDiagram({ compact = false }) {
  if (compact) {
    return (
      <div className="flex items-center justify-center gap-2 flex-wrap py-3 opacity-80">
        {SOURCES.map((s, i) => (
          <SourcePill key={s} label={s} delay={i * 0.3} compact />
        ))}
        <FlowConnector compact />
        <StageBadge label="Articles" compact />
        <FlowConnector compact />
        <NerEngineGroup compact />
        <FlowConnector compact />
        <div className="flex gap-1">
          {SAMPLE_TICKERS.map((t, i) => (
            <TickerChip key={t} ticker={t} delay={i * 0.6} compact />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="border border-hairline rounded-lg bg-surface px-6 py-6 mb-5 flex flex-col items-center gap-1">
      <div className="flex flex-wrap justify-center gap-2">
        {SOURCES.map((s, i) => (
          <SourcePill key={s} label={s} delay={i * 0.3} />
        ))}
      </div>

      <FlowConnector />
      <StageBadge label="Articles" sublabel="deduped, stored" />
      <FlowConnector />
      <NerEngineGroup />
      <FlowConnector />

      <div className="flex gap-2">
        {SAMPLE_TICKERS.map((t, i) => (
          <TickerChip key={t} ticker={t} delay={i * 0.6} />
        ))}
      </div>
      <p className="text-[11px] text-ink-muted mt-2">Broad news search → company identification</p>
    </div>
  )
}
