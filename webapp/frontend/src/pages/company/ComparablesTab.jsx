import { Fragment, useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { getCompanyHistoricalFactors, getCompanyPeers, getCompanySignals, getComparablesRationale } from '../../lib/api'
import {
  computeIntegratedScore, normalCdf, sentimentLevelToScore, zTone, shareOfTotal, TONE_TEXT,
  FACTOR_ORDER, VALUATION_FACTOR_ORDER, SENTIMENT_WINDOW_ORDER, equalWeights, SENTIMENT_DEFAULT_WEIGHTS,
} from '../../lib/factorScoring'
import { getLockedFactorWeights, getLockedSentimentWindowWeights, getLockedMetricWeights } from '../../lib/weightsStore'
import WeightInput from '../../components/WeightInput'
import WeightTotal from '../../components/WeightTotal'

// Peer identification is deliberately light-touch: a rule-based sector
// candidate pool (src/valuation/sector_peers.py) refined by a single LLM
// call into the 3 most relevant direct comps (src/valuation/peer_selection.py),
// cached server-side for hours since peer relationships don't shift day to
// day. No separate page/sidebar entry for it -- it only ever exists in
// service of this comparison, so it lives inline here.
const PEER_SLOTS = 3
const ROW_ORDER = ['composite', ...FACTOR_ORDER]
const ROW_LABELS = { composite: 'Composite', value: 'Value', quality: 'Quality', growth: 'Growth', momentum: 'Momentum', sentiment: 'Sentiment' }
const SENTIMENT_WINDOW_LABELS = { recent: 'Recent (0-3d)', mid: 'Mid (4-14d)', historical: 'Historical (15-30d)' }

// Same metric-formatting convention duplicated in IntegratedScorecard.jsx /
// HistoricalFactorScorecard(Beta).jsx -- small enough, and tied closely
// enough to the fixed backend metric schema, that keeping each scorecard
// self-contained beats threading a shared formatter through every caller.
const PERCENT_METRICS = new Set(['fcf_yield', 'operating_margin', 'return_on_equity', 'revenue_growth', 'eps_growth'])
const MULTIPLE_METRICS = new Set(['trailing_pe', 'ev_to_ebitda', 'price_to_book', 'debt_to_equity', 'cash_conversion'])

function formatMetric(key, value) {
  if (value == null) return '—'
  if (PERCENT_METRICS.has(key)) return `${(value * 100).toFixed(1)}%`
  if (MULTIPLE_METRICS.has(key)) return `${value.toFixed(2)}x`
  return value.toFixed(2)
}

// Two independent visual signals, deliberately not the same box: `isTarget`
// tints the whole column so it's always identifiable as "you" regardless of
// how it scores; `isWinner` rings whichever cell has the highest score in
// that specific row, which may or may not be the target. A cell can be both.
function ScoreCell({ score, z, unit, isTarget, isWinner }) {
  const tone = zTone(z)
  return (
    <div
      className={`rounded-md px-2 py-1.5 text-center ${isTarget ? 'bg-series-1/10' : ''} ${isWinner ? 'ring-2 ring-inset ring-warning' : ''}`}
    >
      <p className={`text-sm font-semibold tabular ${TONE_TEXT[tone]}`}>{score != null ? score.toFixed(0) : 'n/a'}</p>
      <p className="text-[9px] text-ink-muted tabular">{z != null ? `${unit} ${z >= 0 ? '+' : ''}${z.toFixed(2)}` : '—'}</p>
    </div>
  )
}

// One shared weight per factor, applied identically to every column -- this
// is what keeps the comparison apples-to-apples; there's deliberately no
// per-company weight override here (that would defeat the point of
// comparing companies on the same scoring basis). Same free-editing pattern
// as the Scoring tab: editing one weight never touches the others, and the
// % shown is a live "share of total" readout, not an enforced constraint.
function FactorWeightRow({ label, weight, totalWeight, onWeightChange }) {
  const share = shareOfTotal(weight, totalWeight)
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-ink-secondary w-16 shrink-0">{label}</span>
      <WeightInput value={weight} onChange={onWeightChange} title={`Relative weight for ${label} in the composite score`} />
      <span className="text-[9px] text-ink-muted tabular w-8 text-right">{share != null ? `${share.toFixed(0)}%` : '—'}</span>
    </div>
  )
}

// Sub-row cell for an expanded factor's underlying metrics -- lighter-weight
// than ScoreCell (no target tint / row-winner ring; those apply to the
// factor-level comparison, not to individual metrics, which have their own
// units and aren't a single normalized "score").
function MetricCell({ z, formatted }) {
  const tone = zTone(z)
  return (
    <div className="text-center py-1">
      <p className="text-[11px] text-ink-muted tabular">{formatted}</p>
      <p className={`text-[10px] font-medium tabular ${TONE_TEXT[tone]}`}>{z != null ? `z ${z >= 0 ? '+' : ''}${z.toFixed(2)}` : 'n/a'}</p>
    </div>
  )
}

// One colspan row inside the expanded factor/window detail -- the rationale
// text itself, or a loading/error/not-yet-generated placeholder. Kept as its
// own component since it's used from three different spots (per valuation
// factor, per sentiment window) with the same three states.
function RationaleRow({ colSpan, loading, error, text }) {
  return (
    <tr className="bg-panel/30">
      <td colSpan={colSpan} className="py-2 px-3">
        {loading ? (
          <p className="text-[11px] text-ink-muted italic">Generating rationale…</p>
        ) : error ? (
          <p className="text-[11px] text-critical">Rationale failed: {error}</p>
        ) : text ? (
          <p className="text-[11px] text-ink-secondary leading-relaxed">{text}</p>
        ) : (
          <p className="text-[11px] text-ink-muted italic">No rationale yet.</p>
        )}
      </td>
    </tr>
  )
}

function PeerInput({ value, placeholder, onCommit }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value.toUpperCase())}
      onBlur={() => draft.trim() && onCommit(draft.trim())}
      onKeyDown={(e) => e.key === 'Enter' && draft.trim() && onCommit(draft.trim())}
      className="w-24 px-2 py-1 text-[12px] font-mono rounded border border-hairline bg-panel text-ink text-center
                 focus:outline-none focus:ring-1 focus:ring-series-1/50"
    />
  )
}

export default function ComparablesTab() {
  const { ticker, detail } = useOutletContext()

  const [peersInfo, setPeersInfo] = useState(null)
  const [peersLoading, setPeersLoading] = useState(true)
  const [peersError, setPeersError] = useState(null)
  const [peerTickers, setPeerTickers] = useState(null) // null until seeded from suggestions
  const [companyData, setCompanyData] = useState({}) // ticker -> {historical, signals, loading, error}
  const [expandedFactors, setExpandedFactors] = useState({}) // factorKey -> bool
  const [rationale, setRationale] = useState(null) // {valuation: {...}, sentiment: {...}}
  const [rationaleLoading, setRationaleLoading] = useState(false)
  const [rationaleError, setRationaleError] = useState(null)
  // Seeded once from whatever was last locked on Integrated Scoring / the
  // Quantitative Valuation tab (see lib/weightsStore.js) -- still fully
  // editable from here on out, same free-editing behavior as before; this
  // only changes where the starting point comes from.
  const [factorWeights, setFactorWeights] = useState(() => getLockedFactorWeights() || {})
  const hasLockedFactorWeights = getLockedFactorWeights() != null
  const lockedSentimentWindowWeights = getLockedSentimentWindowWeights()
  const lockedMetricWeights = getLockedMetricWeights()

  const seededFactorWeights = Object.keys(factorWeights).length ? factorWeights : equalWeights(FACTOR_ORDER)
  const factorTotalWeight = FACTOR_ORDER.reduce((s, key) => s + (seededFactorWeights[key] ?? 0), 0)

  function setFactorWeight(key, value) {
    setFactorWeights((prev) => ({ ...(Object.keys(prev).length ? prev : seededFactorWeights), [key]: value }))
  }

  useEffect(() => {
    setPeersLoading(true)
    setPeersError(null)
    setPeerTickers(null)
    setCompanyData({})
    getCompanyPeers(ticker)
      .then((data) => {
        setPeersInfo(data)
        setPeerTickers(data.peers.slice(0, PEER_SLOTS).map((p) => p.ticker.toUpperCase()))
      })
      .catch((err) => setPeersError(err.message))
      .finally(() => setPeersLoading(false))
  }, [ticker])

  const columns = [ticker, ...(peerTickers ?? [])].filter(Boolean)

  useEffect(() => {
    const missing = columns.filter((t) => !companyData[t])
    if (!missing.length) return
    setCompanyData((prev) => {
      const next = { ...prev }
      for (const t of missing) next[t] = { loading: true, error: null, historical: null, signals: null }
      return next
    })
    missing.forEach((t) => {
      Promise.all([getCompanyHistoricalFactors(t), getCompanySignals(t).catch(() => null)])
        .then(([historical, signals]) => {
          setCompanyData((prev) => ({ ...prev, [t]: { loading: false, error: null, historical, signals } }))
        })
        .catch((err) => {
          setCompanyData((prev) => ({ ...prev, [t]: { loading: false, error: err.message, historical: null, signals: null } }))
        })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns.join(',')])

  // Fires once when the target+peer set is fully known -- same one-shot
  // pattern the Sentiment tab uses for its own LLM pass. Deliberately NOT
  // keyed on weights: the rationale is about the underlying metric/news
  // evidence, which doesn't change when you reweight the composite, so
  // tweaking a weight shouldn't burn another LLM call.
  useEffect(() => {
    if (!peerTickers || peerTickers.length < PEER_SLOTS) return
    fetchRationale()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, peerTickers ? peerTickers.join(',') : ''])

  function fetchRationale() {
    setRationaleLoading(true)
    setRationaleError(null)
    getComparablesRationale(ticker, peerTickers)
      .then(setRationale)
      .catch((err) => setRationaleError(err.message))
      .finally(() => setRationaleLoading(false))
  }

  function regenerate() {
    setPeersLoading(true)
    setPeersError(null)
    getCompanyPeers(ticker, { refresh: true })
      .then((data) => {
        setPeersInfo(data)
        setPeerTickers(data.peers.slice(0, PEER_SLOTS).map((p) => p.ticker.toUpperCase()))
      })
      .catch((err) => setPeersError(err.message))
      .finally(() => setPeersLoading(false))
  }

  function setPeerSlot(index, value) {
    setPeerTickers((prev) => {
      const next = [...(prev ?? [])]
      next[index] = value.toUpperCase()
      return next
    })
  }

  function toggleFactor(key) {
    setExpandedFactors((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function nameFor(t) {
    if (t === ticker) return detail?.company_name ?? t
    return peersInfo?.peers.find((p) => p.ticker.toUpperCase() === t)?.company_name ?? null
  }
  function reasonFor(t) {
    return peersInfo?.peers.find((p) => p.ticker.toUpperCase() === t)?.reason ?? null
  }

  return (
    <div className="space-y-5">
      <div className="border border-hairline rounded-lg bg-surface px-5 py-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-sm font-semibold">Comparables</p>
            <p className="text-[11px] text-ink-muted mt-0.5 max-w-2xl">
              {peersInfo ? (
                <>Sector: {peersInfo.sector ?? '—'} · Industry: {peersInfo.industry ?? '—'}. Peers below are suggested from
                  the sector's curated peer list, refined by a quick LLM pass for the closest direct comps -- edit any
                  ticker to swap it out.</>
              ) : (
                'Identifying comparable peers…'
              )}
            </p>
          </div>
          <button
            onClick={regenerate}
            disabled={peersLoading}
            className="text-[11px] text-ink-muted hover:text-ink-secondary shrink-0 ml-4 disabled:opacity-50 cursor-pointer"
          >
            {peersLoading ? 'Suggesting…' : '↻ Regenerate suggestions'}
          </button>
        </div>

        {peersError && <p className="text-sm text-critical mb-3">Failed to suggest peers: {peersError}</p>}

        {peerTickers && (
          <div className="flex flex-wrap gap-4 mb-4">
            {peerTickers.map((t, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <PeerInput value={t} placeholder="TICK" onCommit={(v) => setPeerSlot(i, v)} />
                {reasonFor(t) && (
                  <p className="text-[9px] text-ink-muted text-center max-w-[110px] leading-snug" title={reasonFor(t)}>
                    {reasonFor(t)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wide text-ink-muted">
            Composite weights (applied to every company below){' '}
            {hasLockedFactorWeights && (
              <span className="normal-case text-ink-muted/70">-- seeded from Integrated Scoring's locked weights, editable here</span>
            )}
          </span>
          <WeightTotal total={factorTotalWeight} />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-4">
          {FACTOR_ORDER.map((key) => (
            <FactorWeightRow
              key={key}
              label={ROW_LABELS[key]}
              weight={seededFactorWeights[key] ?? 0}
              totalWeight={factorTotalWeight}
              onWeightChange={(v) => setFactorWeight(key, v)}
            />
          ))}
        </div>

        {peerTickers && peerTickers.length === PEER_SLOTS && (
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wide text-ink-muted">
              Expand a factor below for an AI-generated {ticker}-vs-peers rationale, grounded in the metrics/news shown.
            </span>
            <button
              onClick={fetchRationale}
              disabled={rationaleLoading}
              className="text-[10px] text-ink-muted hover:text-ink-secondary shrink-0 ml-4 disabled:opacity-50 cursor-pointer"
            >
              {rationaleLoading ? 'Generating…' : '↻ Regenerate rationale'}
            </button>
          </div>
        )}

        {columns.length > 0 && (() => {
          // Computed once per column (not per cell) -- every row reads from
          // this rather than re-running computeIntegratedScore per cell.
          const scoresByTicker = {}
          for (const t of columns) {
            const cd = companyData[t]
            if (cd && !cd.loading && !cd.error && cd.historical) {
              scoresByTicker[t] = computeIntegratedScore(
                cd.historical, cd.signals?.windows, seededFactorWeights,
                lockedSentimentWindowWeights || SENTIMENT_DEFAULT_WEIGHTS, lockedMetricWeights,
              )
            }
          }

          return (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-[10px] uppercase tracking-wide text-ink-muted font-medium pb-2 pr-3 w-24">Factor</th>
                    {columns.map((t) => (
                      <th key={t} className="text-center pb-2 px-1 min-w-[100px]">
                        <Link to={`/companies/${t}/scoring`} className="text-[12px] font-semibold text-ink hover:text-series-1 font-mono">
                          {t}
                        </Link>
                        <p className="text-[9px] text-ink-muted truncate max-w-[110px] mx-auto">{nameFor(t) ?? ' '}</p>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROW_ORDER.map((row) => {
                    const unit = row === 'sentiment' ? 'level' : 'z'
                    const expandable = row !== 'composite'
                    const expanded = expandable && !!expandedFactors[row]
                    const rowValues = columns.map((t) => {
                      const s = scoresByTicker[t]
                      if (!s) return { t, score: null, z: null }
                      const z = row === 'composite' ? s.compositeZ : s.factorZs[row]
                      const score = row === 'composite'
                        ? s.compositeScore
                        : row === 'sentiment' ? sentimentLevelToScore(z) : (z != null ? normalCdf(z) * 100 : null)
                      return { t, score, z }
                    })
                    const maxScore = rowValues.reduce(
                      (m, r) => (r.score != null && (m == null || r.score > m) ? r.score : m), null,
                    )

                    // Metric/window keys come from whichever column loaded
                    // first -- the schema is fixed per factor (same metrics
                    // for every ticker), so any loaded company's shape works.
                    const firstLoaded = columns.map((t) => companyData[t]).find((cd) => cd?.historical)
                    const metricEntries =
                      expanded && VALUATION_FACTOR_ORDER.includes(row) && firstLoaded
                        ? Object.entries(firstLoaded.historical.factors[row].raw)
                        : []

                    return (
                      <Fragment key={row}>
                        <tr className="border-t border-hairline">
                          <td className="py-1.5 pr-3">
                            {expandable ? (
                              <button
                                onClick={() => toggleFactor(row)}
                                className="flex items-center gap-1 text-[12px] text-ink-secondary hover:text-ink cursor-pointer"
                              >
                                <span className="text-[9px] text-ink-muted w-2.5 inline-block">{expanded ? '▾' : '▸'}</span>
                                {ROW_LABELS[row]}
                              </button>
                            ) : (
                              <span className="text-[12px] text-ink-secondary pl-[15px]">{ROW_LABELS[row]}</span>
                            )}
                          </td>
                          {rowValues.map(({ t, score, z }) => {
                            const cd = companyData[t]
                            if (!cd || cd.loading) {
                              return <td key={t} className="py-1.5 px-1"><p className="text-[11px] text-ink-muted text-center">…</p></td>
                            }
                            if (cd.error || !cd.historical) {
                              return <td key={t} className="py-1.5 px-1"><p className="text-[11px] text-critical text-center">error</p></td>
                            }
                            return (
                              <td key={t} className="py-1 px-1">
                                <ScoreCell
                                  score={score} z={z} unit={unit}
                                  isTarget={t === ticker}
                                  isWinner={score != null && maxScore != null && score === maxScore}
                                />
                              </td>
                            )
                          })}
                        </tr>

                        {expanded && row === 'sentiment' && SENTIMENT_WINDOW_ORDER.map((winKey) => (
                          <Fragment key={`${row}-${winKey}`}>
                            <tr className="bg-panel/30">
                              <td className="py-1 pr-3 pl-5 text-[10px] text-ink-muted">{SENTIMENT_WINDOW_LABELS[winKey]}</td>
                              {columns.map((t) => {
                                const cd = companyData[t]
                                if (!cd || cd.loading || cd.error || !cd.historical) {
                                  return <td key={t} className="py-1 px-1"><p className="text-[10px] text-ink-muted text-center">—</p></td>
                                }
                                const w = cd.signals?.windows?.[winKey]
                                const insufficient = !w || w.insufficient_data
                                return (
                                  <td key={t} className="py-1 px-1 text-center">
                                    <p className="text-[11px] text-ink-muted tabular">
                                      {insufficient ? 'n/a' : `${w.mean_rank >= 0 ? '+' : ''}${w.mean_rank.toFixed(2)}`}
                                    </p>
                                    <p className="text-[9px] text-ink-muted">{w ? `${w.count} article${w.count === 1 ? '' : 's'}` : '—'}</p>
                                  </td>
                                )
                              })}
                            </tr>
                            <RationaleRow
                              colSpan={columns.length + 1}
                              loading={rationaleLoading}
                              error={rationaleError}
                              text={rationale?.sentiment?.[winKey]}
                            />
                          </Fragment>
                        ))}

                        {expanded && metricEntries.map(([metricKey, firstMetric]) => (
                          <tr key={`${row}-${metricKey}`} className="bg-panel/30">
                            <td className="py-1 pr-3 pl-5 text-[10px] text-ink-muted">{firstMetric.label}</td>
                            {columns.map((t) => {
                              const cd = companyData[t]
                              if (!cd || cd.loading || cd.error || !cd.historical) {
                                return <td key={t} className="py-1 px-1"><p className="text-[10px] text-ink-muted text-center">—</p></td>
                              }
                              const m = cd.historical.factors[row].raw[metricKey]
                              return (
                                <td key={t} className="py-1 px-1">
                                  <MetricCell z={m?.zscore} formatted={formatMetric(metricKey, m?.current)} />
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                        {expanded && VALUATION_FACTOR_ORDER.includes(row) && metricEntries.length > 0 && (
                          <RationaleRow
                            colSpan={columns.length + 1}
                            loading={rationaleLoading}
                            error={rationaleError}
                            text={rationale?.valuation?.[row]}
                          />
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })()}

        <p className="text-[10px] text-ink-muted mt-3">
          Each score uses the Integrated Scoring framework. Within each valuation factor, metrics use{' '}
          {lockedMetricWeights ? "the per-metric weights locked on the Quantitative Valuation tab" : 'an equal split'}
          {' '}(lock a scheme there to carry it here); within Sentiment, windows use{' '}
          {lockedSentimentWindowWeights ? "the window weights locked on Integrated Scoring" : 'the 70/30/0 recent/mid/historical default'}.
          The five factor weights above start from whatever's locked on Integrated Scoring too, but are freely
          editable here on top of that -- changes on this page don't write back to the lock. The tinted column is
          {' '}{ticker}; the amber ring on a cell marks whichever company scores highest in that row (may or may not
          be {ticker}, and can land on more than one cell on a tie). Peers without ingested news coverage will show
          Sentiment as n/a; their composite falls back to the four valuation factors only. Click a ticker to open
          that company's own Scoring tab.
        </p>
      </div>
    </div>
  )
}
