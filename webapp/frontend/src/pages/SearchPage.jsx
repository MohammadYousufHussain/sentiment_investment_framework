import { useEffect, useRef, useState } from 'react'
import { getEntities, streamSearch } from '../lib/api'
import SourceStatCard from '../components/SourceStatCard'
import ArticleTable from '../components/ArticleTable'
import CompanyEntitiesCard from '../components/CompanyEntitiesCard'
import NewsFlowDiagram from '../components/NewsFlowDiagram'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [sources, setSources] = useState([])
  const [sourceState, setSourceState] = useState({})
  const [articles, setArticles] = useState([])
  const [running, setRunning] = useState(false)
  const [statusLine, setStatusLine] = useState('')
  const [entities, setEntities] = useState(null)
  const [entitiesLoading, setEntitiesLoading] = useState(false)
  const [entitiesError, setEntitiesError] = useState(null)
  const [filterTicker, setFilterTicker] = useState(null)
  const [hasSearched, setHasSearched] = useState(false)
  const eventSourceRef = useRef(null)

  useEffect(() => () => eventSourceRef.current?.close(), [])

  function runEntityExtraction(q) {
    setEntities(null)
    setEntitiesError(null)
    setEntitiesLoading(true)
    getEntities(q)
      .then((data) => setEntities(data))
      .catch((err) => setEntitiesError(err.message))
      .finally(() => setEntitiesLoading(false))
  }

  function toggleFilter(ticker) {
    setFilterTicker((prev) => (prev === ticker ? null : ticker))
  }

  const filteredArticleIds = filterTicker
    ? new Set(entities?.candidates.find((c) => c.ticker === filterTicker)?.article_ids ?? [])
    : null
  const displayedArticles = filteredArticleIds ? articles.filter((a) => filteredArticleIds.has(a.id)) : articles

  function handleSubmit(e) {
    e.preventDefault()
    const q = query.trim()
    if (!q || running) return

    eventSourceRef.current?.close()
    setSources([])
    setSourceState({})
    setArticles([])
    setEntities(null)
    setEntitiesError(null)
    setFilterTicker(null)
    setHasSearched(true)
    setRunning(true)
    setStatusLine(`Searching for "${q}"…`)

    eventSourceRef.current = streamSearch(q, {
      onEvent: (payload) => {
        if (payload.type === 'sources') {
          setSources(payload.sources)
          setSourceState(Object.fromEntries(payload.sources.map((s) => [s, { status: 'loading' }])))
        } else if (payload.type === 'source_done') {
          setSourceState((prev) => ({
            ...prev,
            [payload.source]: {
              status: payload.status,
              fetched: payload.fetched,
              newCount: payload.new,
              error: payload.error,
            },
          }))
          if (payload.status === 'success') {
            setArticles((prev) =>
              [...prev, ...payload.articles].sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))
            )
          }
        } else if (payload.type === 'complete') {
          setStatusLine(`Done — ${payload.fetched} articles fetched, ${payload.new} newly stored for "${payload.query}".`)
          setRunning(false)
          eventSourceRef.current?.close()
          runEntityExtraction(q)
        } else if (payload.type === 'error') {
          setStatusLine(`Error: ${payload.message}`)
          setRunning(false)
          eventSourceRef.current?.close()
        }
      },
      onError: () => {
        setStatusLine('Connection lost.')
        setRunning(false)
        eventSourceRef.current?.close()
      },
    })
  }

  return (
    <div className="max-w-7xl mx-auto px-8 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Stage A News Ingestion</h1>
        <p className="text-sm text-ink-secondary mt-1">
          Type a keyword or topic — articles stream in live from each source as the pipeline runs.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. renewable energy"
          autoComplete="off"
          className="flex-1 px-4 py-2.5 rounded-lg border border-hairline bg-surface text-ink placeholder:text-ink-muted text-sm focus:outline-none focus:ring-2 focus:ring-series-1/50"
        />
        <button
          type="submit"
          disabled={running}
          className="px-5 py-2.5 rounded-lg bg-series-1 text-white text-sm font-semibold disabled:opacity-50 hover:bg-series-1/90 transition-colors"
        >
          {running ? 'Searching…' : 'Search'}
        </button>
      </form>

      {sources.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          {sources.map((name) => (
            <SourceStatCard
              key={name}
              name={name}
              status={sourceState[name]?.status ?? 'pending'}
              fetched={sourceState[name]?.fetched}
              newCount={sourceState[name]?.newCount}
              error={sourceState[name]?.error}
            />
          ))}
        </div>
      )}

      {!hasSearched && <NewsFlowDiagram />}

      {statusLine && <p className="text-[13px] text-ink-muted mb-4">{statusLine}</p>}

      <CompanyEntitiesCard
        loading={entitiesLoading}
        error={entitiesError}
        data={entities}
        idle={!hasSearched}
        activeFilter={filterTicker}
        onToggleFilter={toggleFilter}
      />

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

      {displayedArticles.length > 0 && <ArticleTable articles={displayedArticles} showSentiment={false} showDedup={false} />}

      {hasSearched && <NewsFlowDiagram compact />}
    </div>
  )
}
