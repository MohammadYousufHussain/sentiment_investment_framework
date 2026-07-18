import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { getStockPitch } from '../../lib/api'
import SentimentEvidenceBlocks from '../../components/SentimentEvidenceBlocks'

// The stock pitch -- one more synthesis call on top of the Bull / Bear
// Case tab's already-generated base/bull/bear cases and sentiment evidence
// (see src/valuation/pitch.py). Deliberately does not re-derive anything
// from raw metrics or articles again; it only argues a position from
// evidence those two prior calls already grounded. The stance toggle below
// picks which case that position is built around -- "auto" lets the model
// weigh the evidence itself, the other three force it to argue specifically
// FOR that stance (same evidence, different angle -- how a real desk
// produces a long pitch and a short pitch off the same research).
const STANCE_OPTIONS = [
  { key: 'Bullish', label: 'Bull Case' },
  { key: 'Neutral', label: 'Neutral' },
  { key: 'Bearish', label: 'Bear Case' },
]
const RECOMMENDATION_TONE = { Bullish: 'good', Neutral: 'accent', Bearish: 'critical' }
const TONE_TEXT = { good: 'text-good', accent: 'text-series-1', critical: 'text-critical' }
const TONE_BG = { good: 'bg-good/15', accent: 'bg-series-1/15', critical: 'bg-critical/15' }
const TONE_BORDER = { good: 'border-good/40', accent: 'border-series-1/40', critical: 'border-critical/40' }
const TONE_DOT = { good: 'bg-good', accent: 'bg-series-1', critical: 'bg-critical' }

function RecommendationBadge({ recommendation }) {
  const tone = RECOMMENDATION_TONE[recommendation] ?? 'accent'
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-md text-sm font-semibold ${TONE_BG[tone]} ${TONE_TEXT[tone]}`}>
      {recommendation}
    </span>
  )
}

function StanceToggle({ selected, onSelect, disabled }) {
  return (
    <div className="flex gap-1 border border-hairline rounded-md p-0.5">
      {STANCE_OPTIONS.map((opt) => {
        const tone = RECOMMENDATION_TONE[opt.key]
        const active = selected === opt.key
        return (
          <button
            key={opt.key}
            onClick={() => onSelect(opt.key)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded text-[12px] font-medium transition-colors disabled:opacity-50 cursor-pointer ${
              active ? `${TONE_BG[tone]} ${TONE_TEXT[tone]}` : 'text-ink-muted hover:text-ink-secondary'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function PillarCard({ title, detail, index }) {
  return (
    <div className="border border-hairline rounded-lg bg-panel px-4 py-3">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[11px] font-mono text-ink-muted">{String(index + 1).padStart(2, '0')}</span>
        <span className="text-[13px] font-semibold text-ink">{title}</span>
      </div>
      <p className="text-[12px] text-ink-secondary leading-relaxed">{detail}</p>
    </div>
  )
}

function BulletList({ items, tone }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-[12px] text-ink-secondary leading-relaxed">
          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[tone]}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export default function InvestmentThesisTab() {
  const { ticker } = useOutletContext()
  const [pitch, setPitch] = useState(null)
  // What was actually requested from the API -- null means "let the model
  // decide" (auto), a stance string means the user picked that toggle. Kept
  // separate from pitch.recommendation (what's showing) so "Regenerate"
  // knows whether to stay in auto mode or re-force the selected stance.
  const [requestedStance, setRequestedStance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  function fetchPitch(stance, { refresh = false } = {}) {
    setLoading(true)
    setError(null)
    setRequestedStance(stance)
    getStockPitch(ticker, stance, { refresh })
      .then(setPitch)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setPitch(null)
    fetchPitch(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker])

  const tone = pitch ? (RECOMMENDATION_TONE[pitch.recommendation] ?? 'accent') : 'accent'

  return (
    <div className="border border-hairline rounded-lg bg-surface px-5 py-4">
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-sm font-semibold">Investment Thesis</p>
          <p className="text-[11px] text-ink-muted mt-0.5 max-w-2xl">
            {pitch
              ? <>The stock pitch for {pitch.company_name} ({pitch.ticker}) -- synthesized directly from the Base,
                  Bull, and Bear cases and sentiment evidence on the <Link to={`/companies/${ticker}/bull-bear-case`} className="text-series-1 hover:underline">Bull / Bear Case</Link> tab.
                  Peers: {pitch.peers?.map((p) => p.ticker).join(', ')}.{' '}
                  {requestedStance
                    ? `Currently arguing the ${requestedStance} case specifically -- pick another stance below to see it argued instead.`
                    : 'Currently the auto-detected stance, weighing which case the evidence favors most -- pick a stance below to see it argued specifically instead.'}
                </>
              : 'Synthesizing a position from the Base, Bull, and Bear case evidence…'}
          </p>
        </div>
        <button
          onClick={() => fetchPitch(requestedStance, { refresh: true })}
          disabled={loading}
          className="text-[11px] text-ink-muted hover:text-ink-secondary shrink-0 ml-4 disabled:opacity-50 cursor-pointer"
        >
          {loading ? 'Generating…' : '↻ Regenerate pitch'}
        </button>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <span className="text-[10px] uppercase tracking-wide text-ink-muted">Build the pitch around</span>
        <StanceToggle selected={pitch?.recommendation} onSelect={fetchPitch} disabled={loading} />
      </div>

      {error && <p className="text-sm text-critical mt-3">Failed to generate stock pitch: {error}</p>}

      {loading && !pitch && (
        <div className="flex items-center gap-2.5 mt-4">
          <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-ink-muted/30 border-t-series-1 animate-spin shrink-0" />
          <p className="text-sm text-ink-secondary">
            Building the pitch -- this chains the full Bull / Bear Case generation plus one more synthesis call,
            so first load can take a minute or more.
          </p>
        </div>
      )}

      {pitch && (
        <>
          <div className={`border rounded-lg px-5 py-4 mt-4 ${TONE_BORDER[tone]}`}>
            <div className="flex items-center gap-3 mb-2">
              <RecommendationBadge recommendation={pitch.recommendation} />
              <span className="text-[10px] uppercase tracking-wide text-ink-muted">
                {requestedStance ? 'Recommendation (stance selected)' : 'Recommendation (auto-detected)'}
              </span>
            </div>
            <p className="text-sm text-ink leading-relaxed">{pitch.thesis_statement}</p>
          </div>

          <div className="mt-5">
            <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-2">Thesis pillars</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {pitch.pillars?.map((p, i) => (
                <PillarCard key={i} title={p.title} detail={p.detail} index={i} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-critical mb-2">
                Risks to this {pitch.recommendation.toLowerCase()} view
              </p>
              <BulletList items={pitch.key_risks ?? []} tone="critical" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-series-1 mb-2">Catalysts to watch</p>
              <BulletList items={pitch.catalysts_to_watch ?? []} tone="accent" />
            </div>
          </div>

          {pitch.sentiment && (
            <div className="mt-5">
              <SentimentEvidenceBlocks
                sentiment={pitch.sentiment}
                ticker={ticker}
                heading="Sentiment by time horizon -- the news evidence behind this pitch"
              />
            </div>
          )}
        </>
      )}

      <p className="text-[10px] text-ink-muted mt-4">
        This pitch argues a position built strictly from the Base/Bull/Bear case analysis and sentiment
        evidence above -- nothing here is invented beyond that evidence.{' '}
        {requestedStance
          ? `You selected the ${requestedStance} stance; the pitch above argues it as rigorously as the
             evidence allows, not necessarily the stance the evidence favors most overall.`
          : 'The recommendation above is a synthesis of which case the evidence favors, not an independent opinion.'}
        {' '}Not investment advice.
      </p>
    </div>
  )
}
