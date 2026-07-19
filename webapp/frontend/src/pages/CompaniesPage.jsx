import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCompanies, getStageBStatus, searchCompanies, triggerStageB } from '../lib/api'
import { Badge } from '../components/Badge'

function AddCompanySearch({ trackedTickers, onStarted }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [statusLine, setStatusLine] = useState('')
  const debounceRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleChange(e) {
    const value = e.target.value
    setQuery(value)
    setStatusLine('')
    clearTimeout(debounceRef.current)
    if (!value.trim()) {
      setResults([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(() => {
      setSearching(true)
      searchCompanies(value.trim())
        .then((data) => {
          setResults(data.results)
          setOpen(true)
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 250)
  }

  function handleSelect(candidate) {
    setOpen(false)
    setQuery('')
    setResults([])
    const already = trackedTickers.has(candidate.ticker)
    triggerStageB([{ ticker: candidate.ticker, company_name: candidate.company_name }])
      .then(() => {
        setStatusLine(
          already
            ? `Re-running Stage B ingestion for ${candidate.ticker} — ${candidate.company_name}…`
            : `Started Stage B ingestion for ${candidate.ticker} — ${candidate.company_name}…`
        )
        onStarted?.()
      })
      .catch((err) => setStatusLine(`Failed to start ${candidate.ticker}: ${err.message}`))
  }

  return (
    <div ref={containerRef} className="relative mb-6">
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search by ticker or company name to add to Stage B…"
        autoComplete="off"
        className="w-full max-w-md px-4 py-2.5 rounded-lg border border-hairline bg-surface text-ink placeholder:text-ink-muted text-sm focus:outline-none focus:ring-2 focus:ring-series-1/50"
      />

      {open && (
        <div className="absolute z-10 mt-1 w-full max-w-md border border-hairline rounded-lg bg-surface shadow-lg overflow-hidden">
          {searching ? (
            <p className="text-[12px] text-ink-muted px-4 py-3">Searching…</p>
          ) : results.length === 0 ? (
            <p className="text-[12px] text-ink-muted px-4 py-3">No matches.</p>
          ) : (
            results.map((c) => (
              <button
                key={c.ticker}
                onClick={() => handleSelect(c)}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-panel transition-colors border-t border-hairline first:border-t-0"
              >
                <span className="min-w-0">
                  <span className="font-mono text-[12px] font-semibold text-series-1 mr-2">{c.ticker}</span>
                  <span className="text-[13px] text-ink-secondary truncate">{c.company_name}</span>
                </span>
                {trackedTickers.has(c.ticker) && <Badge tone="neutral">tracked</Badge>}
              </button>
            ))
          )}
        </div>
      )}

      {statusLine && <p className="text-[12px] text-ink-secondary mt-2">{statusLine}</p>}
    </div>
  )
}

function StatusBadge({ status }) {
  if (status === 'running') return <Badge tone="accent">processing…</Badge>
  if (status === 'error') return <Badge tone="critical">error</Badge>
  return <Badge tone="good">tracked</Badge>
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState([])
  const [jobs, setJobs] = useState({})
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef(null)

  function refresh() {
    Promise.all([getCompanies(), getStageBStatus()])
      .then(([companiesData, jobsData]) => {
        setCompanies(companiesData.companies)
        setJobs(jobsData)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    intervalRef.current = setInterval(refresh, 3000)
    return () => clearInterval(intervalRef.current)
  }, [])

  // Merge the persisted roster (from the DB) with in-memory job status --
  // a ticker mid-processing may not have articles from every source yet,
  // but should still show up with a "processing" row rather than waiting
  // for the whole job to finish.
  const byTicker = {}
  for (const c of companies) byTicker[c.ticker] = { ...c, status: 'tracked' }
  for (const [ticker, job] of Object.entries(jobs)) {
    byTicker[ticker] = {
      ticker,
      company_name: job.company_name,
      article_count: byTicker[ticker]?.article_count ?? 0,
      earliest: byTicker[ticker]?.earliest ?? null,
      latest: byTicker[ticker]?.latest ?? null,
      themes: byTicker[ticker]?.themes ?? [],
      status: job.status,
      sourcesDone: Object.keys(job.sources || {}).length,
    }
  }
  const rows = Object.values(byTicker).sort((a, b) => a.ticker.localeCompare(b.ticker))

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Companies</h1>
        <p className="text-sm text-ink-secondary mt-1">
          Tickers selected for Stage B deep ingestion — this is where their news, sentiment, and signals accumulate.
        </p>
      </header>

      <AddCompanySearch trackedTickers={new Set(rows.map((r) => r.ticker))} onStarted={refresh} />

      {loading ? (
        <p className="text-sm text-ink-muted py-8 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted py-8 text-center">
          No companies tracked yet — search for a ticker or company name above, or select candidates from a
          Stage A search, to start Stage B ingestion.
        </p>
      ) : (
        <div className="border border-hairline rounded-lg overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-panel text-ink-muted text-[11px] uppercase tracking-wide">
                <th className="text-left font-medium px-4 py-2.5">Ticker</th>
                <th className="text-left font-medium px-3 py-2.5">Company</th>
                <th className="text-left font-medium px-3 py-2.5">Discovered via</th>
                <th className="text-left font-medium px-3 py-2.5">Articles</th>
                <th className="text-left font-medium px-3 py-2.5">Coverage</th>
                <th className="text-left font-medium px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.ticker} className="border-t border-hairline hover:bg-panel/50 transition-colors">
                  <td className="px-4 py-2.5">
                    <Link to={`/companies/${c.ticker}`} className="font-mono text-[12px] font-semibold text-series-1 hover:underline">
                      {c.ticker}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-ink truncate max-w-[200px]">{c.company_name}</td>
                  <td className="px-3 py-2.5 text-[11px] text-ink-muted truncate max-w-[220px]">
                    {c.themes.length ? c.themes.join(', ') : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] tabular text-ink-secondary">{c.article_count}</td>
                  <td className="px-3 py-2.5 text-[11px] text-ink-muted whitespace-nowrap">
                    {c.earliest ? `${formatDate(c.earliest)} – ${formatDate(c.latest)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
