import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { getCompanyDetail, getStageBStatus, triggerStageB } from '../../lib/api'

const TABS = [
  { to: 'sentiment', label: 'Sentiment & News' },
  { to: 'valuation', label: 'Quantitative Valuation' },
  { to: 'scoring', label: 'Integrated Scoring' },
  { to: 'comparables', label: 'Comparables' },
  { to: 'bull-bear-case', label: 'Bull / Bear Case' },
  { to: 'thesis', label: 'Investment Thesis' },
]

function FetchNewsButton({ ticker, companyName, job, onStarted }) {
  const [error, setError] = useState(null)
  // Re-runs Stage B for this ticker. The layout's existing 3s status poll
  // picks the job up, so `job` flipping to running is what disables us --
  // no local "in flight" state to keep in sync.
  const running = job?.status === 'running'

  function start() {
    setError(null)
    triggerStageB([{ ticker, company_name: companyName ?? ticker }])
      .then(() => onStarted?.())
      .catch((err) => setError(err.message))
  }

  return (
    <div className="text-right">
      <button
        onClick={start}
        disabled={running}
        className="rounded-md border border-hairline px-3.5 py-2 text-[12px] font-medium text-ink-secondary hover:text-ink hover:bg-panel disabled:opacity-60 disabled:cursor-default transition-colors"
      >
        {running
          ? `Fetching latest news… (${Object.keys(job.sources ?? {}).length} sources done)`
          : '↻ Fetch latest news'}
      </button>
      {error && <p className="text-[11px] text-critical mt-1">{error}</p>}
    </div>
  )
}

export default function CompanyLayout() {
  const { ticker } = useParams()
  const [detail, setDetail] = useState(null)
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const intervalRef = useRef(null)
  const hasLoadedRef = useRef(false)

  function refresh() {
    getCompanyDetail(ticker)
      .then((data) => {
        setDetail(data)
        setNotFound(false)
        hasLoadedRef.current = true
      })
      .catch(() => {
        if (!hasLoadedRef.current) setNotFound(true)
      })
      .finally(() => setLoading(false))

    getStageBStatus()
      .then((jobs) => setJob(jobs[ticker] ?? null))
      .catch(() => {})
  }

  useEffect(() => {
    setLoading(true)
    hasLoadedRef.current = false
    refresh()
    intervalRef.current = setInterval(refresh, 3000)
    return () => clearInterval(intervalRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker])

  if (loading) {
    return <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10 text-sm text-ink-muted">Loading…</div>
  }

  if (notFound && !detail) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10">
        <p className="text-sm text-ink-muted">
          No Stage B data for {ticker} yet
          {job ? ' — ingestion is still running.' : '.'}
        </p>
        <Link to="/companies" className="text-[12px] text-series-1 hover:underline mt-2 inline-block">
          ← Back to Companies
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10">
      <header className="mb-6">
        <Link to="/companies" className="text-[12px] text-ink-muted hover:text-ink mb-2 inline-block">
          ← Companies
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="text-xl font-semibold tracking-tight font-mono">{ticker}</h1>
              <span className="text-lg text-ink-secondary">{detail?.company_name}</span>
            </div>
            {detail?.themes?.length > 0 && (
              <p className="text-[12px] text-ink-muted mt-1">Discovered via: {detail.themes.join(', ')}</p>
            )}
          </div>
          <FetchNewsButton ticker={ticker} companyName={detail?.company_name} job={job} onStarted={refresh} />
        </div>
      </header>

      <nav className="flex gap-1 mb-8 border-b border-hairline overflow-x-auto">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `px-3.5 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'border-series-1 text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink-secondary hover:border-hairline'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ ticker, detail, job, refresh }} />
    </div>
  )
}
