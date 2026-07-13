import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { getCompanyHistoricalFactors, getCompanySignals } from '../../lib/api'
import IntegratedScorecard from '../../components/IntegratedScorecard'

export default function ScoringTab() {
  const { ticker } = useOutletContext()
  const [historical, setHistorical] = useState(null)
  const [signals, setSignals] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setHistorical(null)
    setSignals(null)

    Promise.all([
      getCompanyHistoricalFactors(ticker),
      // Signals is best-effort -- a ticker with no sentiment analysis run
      // yet shouldn't block the valuation half of the score from showing.
      getCompanySignals(ticker).catch(() => null),
    ])
      .then(([historicalResult, signalsResult]) => {
        setHistorical(historicalResult)
        setSignals(signalsResult)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [ticker])

  return <IntegratedScorecard loading={loading} error={error} historical={historical} signals={signals} />
}
