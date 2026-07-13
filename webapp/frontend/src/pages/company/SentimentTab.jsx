import { useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { getCompanySignals, streamCompanySentiment } from '../../lib/api'
import ArticleTable from '../../components/ArticleTable'
import SourceStatCard from '../../components/SourceStatCard'
import SentimentSummaryCard from '../../components/SentimentSummaryCard'
import TimeCoverageBar from '../../components/TimeCoverageBar'
import SignalsCard from '../../components/SignalsCard'

const SOURCE_NAMES = ['google_news_rss', 'newsapi', 'alpha_vantage', 'benzinga', 'yahoo_ticker_news']

export default function SentimentTab() {
  const { ticker, detail, job } = useOutletContext()
  const [sentiment, setSentiment] = useState(null)
  const [sentimentLoading, setSentimentLoading] = useState(false)
  const [sentimentError, setSentimentError] = useState(null)
  const [sentimentProgress, setSentimentProgress] = useState(null)
  const [signals, setSignals] = useState(null)
  const [signalsLoading, setSignalsLoading] = useState(false)
  const [signalsError, setSignalsError] = useState(null)
  const sentimentStreamRef = useRef(null)

  useEffect(() => {
    // Deliberately not part of CompanyLayout's 3s detail/job poll -- scoring
    // can take up to a minute on first run (idempotent after that), so it
    // fires once per ticker rather than being re-triggered on every refresh.
    setSentiment(null)
    setSentimentError(null)
    setSentimentProgress(null)
    setSentimentLoading(true)
    setSignals(null)
    setSignalsError(null)

    sentimentStreamRef.current?.close()
    sentimentStreamRef.current = streamCompanySentiment(ticker, {
      onEvent: (payload) => {
        if (payload.type === 'progress') {
          setSentimentProgress(payload)
        } else if (payload.type === 'complete') {
          setSentiment(payload)
          setSentimentLoading(false)
          sentimentStreamRef.current?.close()
          // Signals depend on sentiment already being scored -- fetched after,
          // not in parallel, so it isn't computed against a stale/empty state.
          // Its own success/failure is independent of sentiment's.
          setSignalsLoading(true)
          getCompanySignals(ticker)
            .then(setSignals)
            .catch((err) => setSignalsError(err.message))
            .finally(() => setSignalsLoading(false))
        }
      },
      onError: () => {
        setSentimentError('Connection lost while scoring sentiment.')
        setSentimentLoading(false)
        sentimentStreamRef.current?.close()
      },
    })

    return () => sentimentStreamRef.current?.close()
  }, [ticker])

  const articlesWithSentiment = (detail?.articles ?? []).map((a) => {
    const combined = sentiment?.article_results?.[String(a.id)]
    if (!combined) return a
    return {
      ...a,
      our_sentiment_label: combined.label,
      finbert_sentiment_label: combined.finbert?.label,
      finbert_sentiment_confidence: combined.finbert?.confidence,
      llm_sentiment_label: combined.llm?.label,
      llm_sentiment_confidence: combined.llm?.confidence,
      llm_relevance: combined.llm?.relevance,
      llm_relevance_reason: combined.llm?.relevance_reason,
    }
  })

  return (
    <>
      <div className="mb-6">
        <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-3">Stage B ingestion</p>
        <div className="flex flex-wrap gap-3">
          {SOURCE_NAMES.map((name) => {
            // Priority: a live in-memory job (this session) > the last
            // persisted ingestion_runs row (survives a server restart, so a
            // source that genuinely ran and found 0 articles -- e.g. Benzinga
            // often has nothing for a given ticker -- reads as "done", not a
            // permanently-stuck "queued") > true pending if neither exists.
            const jobSource = job?.sources?.[name]
            const persistedRun = detail?.source_runs?.[name]
            const dbCount = detail?.source_counts?.[name] ?? 0

            let status, fetched, newCount, error
            if (jobSource) {
              ;({ status, fetched, new: newCount, error } = jobSource)
            } else if (persistedRun) {
              status = persistedRun.status
              fetched = persistedRun.fetched ?? dbCount
              newCount = persistedRun.new
              error = persistedRun.error
            } else {
              status = dbCount > 0 ? 'success' : job?.status === 'running' ? 'loading' : 'pending'
              fetched = dbCount
            }

            return (
              <SourceStatCard
                key={name}
                name={name}
                status={status}
                fetched={fetched}
                newCount={newCount}
                error={error}
              />
            )
          })}
        </div>
      </div>

      {detail?.age_histogram && (
        <TimeCoverageBar histogram={detail.age_histogram} earliest={detail.earliest} latest={detail.latest} />
      )}

      <SentimentSummaryCard loading={sentimentLoading} error={sentimentError} data={sentiment} progress={sentimentProgress} />

      <SignalsCard loading={signalsLoading} error={signalsError} data={signals} />

      <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-3 mt-8">
        News ({detail?.articles?.length ?? 0})
      </p>
      {detail?.articles?.length > 0 ? (
        <ArticleTable articles={articlesWithSentiment} showSentiment showDedup={false} />
      ) : (
        <p className="text-sm text-ink-muted py-4">No articles yet.</p>
      )}
    </>
  )
}
