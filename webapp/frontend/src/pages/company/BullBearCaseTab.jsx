import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { getInvestmentThesis } from '../../lib/api'
import SentimentEvidenceBlocks from '../../components/SentimentEvidenceBlocks'

// One synthesis call chained on top of the same valuation + sentiment
// rationale calls Comparables uses (see src/valuation/thesis.py) -- kept
// consistent with what those tabs already say about this company rather
// than re-deriving a competing narrative from raw numbers again. This page's
// output (base/bull/bear cases + sentiment evidence) is itself the input
// evidence for the Investment Thesis tab's stock pitch synthesis.
const CASES = [
  { key: 'base_case', label: 'Base Case', tone: 'accent', description: 'The single most likely path given the current evidence.' },
  { key: 'bull_case', label: 'Bull Case', tone: 'good', description: 'What would have to go right for upside beyond the base case.' },
  { key: 'bear_case', label: 'Bear Case', tone: 'critical', description: 'What would have to go wrong.' },
]

const TONE_BORDER = { accent: 'border-series-1/40', good: 'border-good/40', critical: 'border-critical/40' }
const TONE_TEXT = { accent: 'text-series-1', good: 'text-good', critical: 'text-critical' }
const TONE_DOT = { accent: 'bg-series-1', good: 'bg-good', critical: 'bg-critical' }

function CaseCard({ label, tone, description, caseData }) {
  return (
    <div className={`border rounded-lg bg-surface px-5 py-4 ${TONE_BORDER[tone]}`}>
      <div className="flex items-baseline justify-between mb-1">
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${TONE_TEXT[tone]}`}>{label}</span>
      </div>
      <p className="text-[10px] text-ink-muted mb-3">{description}</p>
      {caseData ? (
        <>
          <p className="text-sm font-medium text-ink mb-3 leading-snug">{caseData.stance}</p>
          <ul className="space-y-2">
            {caseData.points.map((point, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-ink-secondary leading-relaxed">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[tone]}`} />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[12px] text-ink-muted italic">—</p>
      )}
    </div>
  )
}

export default function BullBearCaseTab() {
  const { ticker } = useOutletContext()
  const [thesis, setThesis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  function fetchThesis({ refresh = false } = {}) {
    setLoading(true)
    setError(null)
    getInvestmentThesis(ticker, { refresh })
      .then(setThesis)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setThesis(null)
    fetchThesis()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker])

  return (
    <div className="border border-hairline rounded-lg bg-surface px-5 py-4">
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-sm font-semibold">Bull / Bear Case</p>
          <p className="text-[11px] text-ink-muted mt-0.5 max-w-2xl">
            {thesis
              ? <>Base, Bull, and Bear cases for {thesis.company_name} ({thesis.ticker}), synthesized from the same
                  valuation-vs-peers and sentiment-vs-peers analysis shown on the Comparables tab, plus any detected
                  sentiment signals (sharp inflections, sustained trends) from the Sentiment &amp; News tab. Peers:
                  {' '}{thesis.peers?.map((p) => p.ticker).join(', ')}. The Investment Thesis tab synthesizes these
                  three cases into a single stock pitch.</>
              : 'Synthesizing valuation, sentiment, and peer-standing evidence into three cases…'}
          </p>
        </div>
        <button
          onClick={() => fetchThesis({ refresh: true })}
          disabled={loading}
          className="text-[11px] text-ink-muted hover:text-ink-secondary shrink-0 ml-4 disabled:opacity-50 cursor-pointer"
        >
          {loading ? 'Generating…' : '↻ Regenerate'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-critical mt-3">Failed to generate cases: {error}</p>
      )}

      {loading && !thesis && (
        <div className="flex items-center gap-2.5 mt-4">
          <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-ink-muted/30 border-t-series-1 animate-spin shrink-0" />
          <p className="text-sm text-ink-secondary">
            Building the cases -- this chains a valuation comparison, a news sentiment comparison, and a final
            synthesis call, so first load can take under a minute.
          </p>
        </div>
      )}

      {thesis && (
        <div className="space-y-3 mt-4">
          {CASES.map((c) => (
            <CaseCard key={c.key} label={c.label} tone={c.tone} description={c.description} caseData={thesis[c.key]} />
          ))}
        </div>
      )}

      {thesis?.sentiment && (
        <div className="mt-5">
          <SentimentEvidenceBlocks
            sentiment={thesis.sentiment}
            ticker={ticker}
            heading="Sentiment by time horizon -- the evidence behind the cases above"
          />
        </div>
      )}

      <p className="text-[10px] text-ink-muted mt-4">
        Every point above is grounded in specific metrics, z-scores, peer comparisons, or news headlines already
        surfaced on the Quantitative Valuation, Sentiment &amp; News, and Comparables tabs -- nothing here is
        invented beyond that evidence. Not investment advice.
      </p>
    </div>
  )
}
