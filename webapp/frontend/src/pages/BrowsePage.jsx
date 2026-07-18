import { useEffect, useState } from 'react'
import { getArticles, getEntities, getFilters } from '../lib/api'
import ArticleTable from '../components/ArticleTable'
import SourceBarChart from '../components/SourceBarChart'
import CompanyEntitiesCard from '../components/CompanyEntitiesCard'

export default function BrowsePage() {
  const [filters, setFilters] = useState({ sources: [], queries: [], total: 0, counts_by_source: {} })
  const [source, setSource] = useState('')
  const [queryFilter, setQueryFilter] = useState('lithium batteries')
  const [limit, setLimit] = useState(30)
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [entities, setEntities] = useState(null)
  const [entitiesLoading, setEntitiesLoading] = useState(false)
  const [entitiesError, setEntitiesError] = useState(null)
  const [filterTicker, setFilterTicker] = useState(null)

  useEffect(() => {
    getFilters().then(setFilters).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    getArticles({ source, query: queryFilter, limit })
      .then((data) => setArticles(data.articles))
      .catch(() => setArticles([]))
      .finally(() => setLoading(false))
  }, [source, queryFilter, limit])

  useEffect(() => {
    setFilterTicker(null)
    if (!queryFilter) {
      setEntities(null)
      setEntitiesError(null)
      return
    }
    setEntities(null)
    setEntitiesError(null)
    setEntitiesLoading(true)
    getEntities(queryFilter)
      .then((data) => setEntities(data))
      .catch((err) => setEntitiesError(err.message))
      .finally(() => setEntitiesLoading(false))
  }, [queryFilter])

  function toggleFilter(ticker) {
    setFilterTicker((prev) => (prev === ticker ? null : ticker))
  }

  const filteredArticleIds = filterTicker
    ? new Set(entities?.candidates.find((c) => c.ticker === filterTicker)?.article_ids ?? [])
    : null
  const displayedArticles = filteredArticleIds ? articles.filter((a) => filteredArticleIds.has(a.id)) : articles

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Browse Stored Articles</h1>
        <p className="text-sm text-ink-secondary mt-1">
          {filters.total.toLocaleString()} articles total in the database.
        </p>
      </header>

      {Object.keys(filters.counts_by_source).length > 0 && (
        <div className="border border-hairline rounded-lg bg-surface px-5 py-4 mb-6">
          <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-3">Articles by source</p>
          <SourceBarChart counts={filters.counts_by_source} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-5">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="px-3 py-2 rounded-md border border-hairline bg-surface text-sm text-ink"
        >
          <option value="">All sources</option>
          {filters.sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={queryFilter}
          onChange={(e) => setQueryFilter(e.target.value)}
          className="px-3 py-2 rounded-md border border-hairline bg-surface text-sm text-ink"
        >
          <option value="">All queries</option>
          {filters.queries.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>

        <input
          type="number"
          min={1}
          max={200}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="w-20 px-3 py-2 rounded-md border border-hairline bg-surface text-sm text-ink tabular"
        />
      </div>

      {queryFilter ? (
        (entitiesLoading || entitiesError || entities) && (
          <CompanyEntitiesCard
            loading={entitiesLoading}
            error={entitiesError}
            data={entities}
            activeFilter={filterTicker}
            onToggleFilter={toggleFilter}
          />
        )
      ) : (
        <p className="text-[12px] text-ink-muted mb-5">Select a specific query above to see identified companies.</p>
      )}

      {filterTicker && (
        <div className="flex items-center gap-2 mb-3 text-[12px] text-ink-secondary">
          <span>
            Showing {displayedArticles.length} article{displayedArticles.length === 1 ? '' : 's'} mentioning{' '}
            <span className="font-mono font-semibold text-ink">{filterTicker}</span>
          </span>
          <button onClick={() => setFilterTicker(null)} className="text-series-1 font-medium hover:underline">
            Clear filter
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted py-8 text-center">Loading…</p>
      ) : (
        <ArticleTable articles={displayedArticles} showQuery showSentiment={false} showDedup={false} />
      )}
    </div>
  )
}
