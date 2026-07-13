import { Fragment, useState } from 'react'
import { Badge, SentimentBadge } from './Badge'

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function FullTextBadge({ status, length }) {
  if (!status) return <Badge tone="neutral">not scraped</Badge>
  if (status === 'success') return <Badge tone="good">{length.toLocaleString()} chars</Badge>
  return <Badge tone="warning">{status}</Badge>
}

function MethodSentimentBadge({ label, confidence }) {
  if (!label) return <span className="text-[11px] text-ink-muted">—</span>
  return (
    <span title={confidence != null ? `confidence: ${Math.round(confidence * 100)}%` : undefined}>
      <SentimentBadge label={label} />
    </span>
  )
}

function RelevanceBadge({ relevance, reason }) {
  if (!relevance) return <span className="text-[11px] text-ink-muted">—</span>
  const tone = relevance === 'Primary' ? 'good' : relevance === 'Secondary' ? 'warning' : 'critical'
  return (
    <span title={reason}>
      <Badge tone={tone}>{relevance}</Badge>
    </span>
  )
}

export default function ArticleTable({ articles, showQuery = false, showSentiment = true, showDedup = true }) {
  const [expandedId, setExpandedId] = useState(null)

  if (!articles.length) {
    return <p className="text-sm text-ink-muted py-8 text-center">No articles to show.</p>
  }

  const colCount = 4 + (showQuery ? 1 : 0) + (showSentiment ? 3 : 0) + (showDedup ? 1 : 0)

  return (
    <div className="border border-hairline rounded-lg overflow-hidden">
      {showSentiment && (
        <div className="px-4 py-2.5 border-b border-hairline bg-panel/40 text-[11px] text-ink-muted leading-relaxed space-y-1">
          <p>
            <span className="font-semibold text-ink-secondary">FinBERT</span> — a local financial-sentiment model
            scores the sentences that actually mention this ticker/company (not the whole article), giving a
            positive/neutral/negative probability per sentence.
          </p>
          <p>
            <span className="font-semibold text-ink-secondary">LLM</span> — Gemini reads the full article and
            judges sentiment specifically toward this company (articles are often mixed for different companies
            mentioned together), returning a label plus a quote grounding its answer in the actual text.
          </p>
          <p>
            <span className="font-semibold text-ink-secondary">Relevance</span> — the LLM separately judges
            whether this company is the article's actual subject (<em>Primary</em>), a meaningfully discussed part
            of it (<em>Secondary</em>), or just an incidental reference like a comparison or analogy
            (<em>Incidental</em>) — e.g. "imagine buying Amazon on its IPO day" in an article about SpaceX.
          </p>
        </div>
      )}
      <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-panel text-ink-muted text-[11px] uppercase tracking-wide">
            <th className="text-left font-medium px-4 py-2.5">Article</th>
            <th className="text-left font-medium px-3 py-2.5">Source</th>
            {showQuery && <th className="text-left font-medium px-3 py-2.5">Query</th>}
            <th className="text-left font-medium px-3 py-2.5">Published</th>
            {showSentiment && (
              <>
                <th className="text-left font-medium px-3 py-2.5">FinBERT</th>
                <th className="text-left font-medium px-3 py-2.5">LLM</th>
                <th className="text-left font-medium px-3 py-2.5">Relevance</th>
              </>
            )}
            {showDedup && <th className="text-left font-medium px-3 py-2.5">Dedup</th>}
            <th className="text-left font-medium px-3 py-2.5">Full text</th>
          </tr>
        </thead>
        <tbody>
          {articles.map((a) => {
            const key = a.id ?? a.url
            const isExpanded = expandedId === key
            const hasDetail = a.summary || a.full_text
            return (
              <Fragment key={key}>
                <tr
                  onClick={() => hasDetail && setExpandedId(isExpanded ? null : key)}
                  className={`border-t border-hairline transition-colors ${hasDetail ? 'cursor-pointer' : ''} ${
                    isExpanded ? 'bg-panel' : 'hover:bg-panel/50'
                  }`}
                >
                  <td className="px-4 py-2.5 min-w-[240px] max-w-sm">
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-ink hover:text-series-1 transition-colors"
                    >
                      {a.title}
                    </a>
                    {a.author && <div className="text-[11px] text-ink-muted mt-0.5 truncate">{a.author}</div>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-ink-secondary whitespace-nowrap">{a.source}</td>
                  {showQuery && (
                    <td className="px-3 py-2.5 text-[12px] text-ink-secondary whitespace-nowrap">{a.query_context}</td>
                  )}
                  <td className="px-3 py-2.5 text-[12px] text-ink-secondary tabular whitespace-nowrap">
                    {formatDate(a.published_at)}
                  </td>
                  {showSentiment && (
                    <>
                      <td className="px-3 py-2.5">
                        <MethodSentimentBadge label={a.finbert_sentiment_label} confidence={a.finbert_sentiment_confidence} />
                      </td>
                      <td className="px-3 py-2.5">
                        <MethodSentimentBadge label={a.llm_sentiment_label} confidence={a.llm_sentiment_confidence} />
                      </td>
                      <td className="px-3 py-2.5">
                        <RelevanceBadge relevance={a.llm_relevance} reason={a.llm_relevance_reason} />
                      </td>
                    </>
                  )}
                  {showDedup && (
                    <td className="px-3 py-2.5">
                      <Badge tone={a.is_new ? 'accent' : 'neutral'}>{a.is_new ? 'new' : 'seen'}</Badge>
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <FullTextBadge status={a.full_text_status} length={a.full_text_len ?? a.full_text?.length} />
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-surface border-t border-hairline">
                    <td colSpan={colCount} className="px-4 py-4">
                      {a.summary && (
                        <div className="mb-3">
                          <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-1">Provider summary</p>
                          <p className="text-[13px] text-ink-secondary leading-relaxed">{a.summary}</p>
                        </div>
                      )}
                      {a.full_text && (
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-1">
                            Scraped full text ({(a.full_text_len ?? a.full_text.length).toLocaleString()} chars)
                          </p>
                          <p className="text-[13px] text-ink-secondary leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
                            {a.full_text}
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}
