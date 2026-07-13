import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { getCompanyHistoricalFactors, getCompanyValuation } from '../../lib/api'
import ProfitabilityTrendChart, { METRICS, formatPct } from '../../components/ProfitabilityTrendChart'
import HistoricalFactorScorecard from '../../components/HistoricalFactorScorecard'
import HistoricalFactorScorecardBeta from '../../components/HistoricalFactorScorecardBeta'

function formatPeriodLabel(fiscalDate, period) {
  if (!fiscalDate) return ''
  const [year, month] = fiscalDate.split('-')
  if (period === 'annual') return `FY${year}`
  const quarter = Math.ceil(Number(month) / 3)
  return `Q${quarter} ${year}`
}

export default function ValuationTab() {
  const { ticker } = useOutletContext()
  const [period, setPeriod] = useState('annual')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [historical, setHistorical] = useState(null)
  const [historicalLoading, setHistoricalLoading] = useState(true)
  const [historicalError, setHistoricalError] = useState(null)
  const [scorecardVersion, setScorecardVersion] = useState('compact')

  useEffect(() => {
    setLoading(true)
    setError(null)
    getCompanyValuation(ticker, period)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [ticker, period])

  useEffect(() => {
    // Independent of the ratios/trend fetch above -- this one fetches its
    // own 5yr price history plus AV/balance-sheet data, so it shouldn't
    // block or be blocked by the rest of the tab.
    setHistoricalLoading(true)
    setHistoricalError(null)
    getCompanyHistoricalFactors(ticker)
      .then(setHistorical)
      .catch((err) => setHistoricalError(err.message))
      .finally(() => setHistoricalLoading(false))
  }, [ticker])

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <div className="flex gap-1 border border-hairline rounded-md p-0.5">
          {[
            { key: 'compact', label: 'Compact' },
            { key: 'full', label: 'Full' },
          ].map((v) => (
            <button
              key={v.key}
              onClick={() => setScorecardVersion(v.key)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                scorecardVersion === v.key ? 'bg-panel text-ink' : 'text-ink-muted hover:text-ink-secondary'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {scorecardVersion === 'full' ? (
        <HistoricalFactorScorecard loading={historicalLoading} error={historicalError} data={historical} />
      ) : (
        <HistoricalFactorScorecardBeta loading={historicalLoading} error={historicalError} data={historical} />
      )}

      <div className="border border-hairline rounded-lg bg-surface px-5 py-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold">Profitability Trend</p>
          <div className="flex gap-1 border border-hairline rounded-md p-0.5">
            {['annual', 'quarterly'].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium capitalize transition-colors ${
                  period === p ? 'bg-panel text-ink' : 'text-ink-muted hover:text-ink-secondary'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-ink-muted mb-4">
          Revenue growth, gross/operating/net margin from Alpha Vantage's income statement, standardized to the
          same revenue-denominated basis per period so periods are directly comparable. Growth is year-over-year
          to avoid seasonality noise, {period === 'annual' ? 'showing the last 5 fiscal years' : 'showing the last 8 quarters'}.
        </p>

        {error ? (
          <p className="text-sm text-critical">Failed to load: {error}</p>
        ) : loading && !data ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : data.profitability.length === 0 ? (
          <p className="text-sm text-ink-muted">No income statement data available for this ticker.</p>
        ) : (
          <>
            <ProfitabilityTrendChart periods={data.profitability} period={period} />

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="text-ink-muted text-[10px] uppercase tracking-wide">
                    <th className="text-left font-medium py-1.5 pr-3">Period</th>
                    {METRICS.map((m) => (
                      <th key={m.key} className="text-right font-medium py-1.5 pl-3">{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.profitability.map((p) => (
                    <tr key={p.fiscal_date} className="border-t border-hairline">
                      <td className="py-1.5 pr-3 text-ink-secondary whitespace-nowrap">{formatPeriodLabel(p.fiscal_date, period)}</td>
                      {METRICS.map((m) => (
                        <td key={m.key} className="py-1.5 pl-3 text-right tabular text-ink">{formatPct(p[m.key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
