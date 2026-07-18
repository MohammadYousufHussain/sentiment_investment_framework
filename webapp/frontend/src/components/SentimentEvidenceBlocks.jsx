import { Link } from 'react-router-dom'
import { SentimentBadge } from './Badge'

// Shared between Bull / Bear Case and Investment Thesis -- both pages
// ultimately cite the same underlying sentiment evidence (see
// src/valuation/thesis.py), so this renders it identically in both places
// rather than each page reimplementing its own version.
const SENTIMENT_WINDOWS = [
  { key: 'recent', label: 'Recent (0-3d)' },
  { key: 'mid', label: 'Mid (4-14d)' },
  { key: 'historical', label: 'Historical (15-30d)' },
]

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Links out in two directions on purpose: the headline itself goes to the
// original source (read the actual story), while the window block below
// links back into this app's own Sentiment & News tab (see the same
// article in context with everything else scored for this ticker).
function ArticleLink({ role, article }) {
  if (!article) {
    return <p className="text-[11px] text-ink-muted italic">No {role} article this window.</p>
  }
  return (
    <a href={article.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 group">
      <SentimentBadge label={article.label} />
      <div className="min-w-0">
        <p className="text-[12px] text-ink-secondary leading-snug group-hover:text-series-1 group-hover:underline">
          {article.title}
        </p>
        <p className="text-[10px] text-ink-muted mt-0.5">{article.source} · {formatDate(article.published_at)}</p>
      </div>
    </a>
  )
}

function SentimentWindowBlock({ label, text, articles, ticker }) {
  return (
    <div className="border border-hairline rounded-lg bg-panel px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-ink uppercase tracking-wide">{label}</span>
        <Link to={`/companies/${ticker}/sentiment`} className="text-[10px] text-ink-muted hover:text-series-1 shrink-0 ml-3">
          ↗ View in Sentiment &amp; News
        </Link>
      </div>
      {text && <p className="text-[12px] text-ink-secondary leading-relaxed mb-3">{text}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[9px] uppercase tracking-wide text-ink-muted mb-1.5">Most bullish</p>
          <ArticleLink role="bullish" article={articles?.bullish} />
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide text-ink-muted mb-1.5">Most bearish</p>
          <ArticleLink role="bearish" article={articles?.bearish} />
        </div>
      </div>
    </div>
  )
}

export default function SentimentEvidenceBlocks({ sentiment, ticker, heading }) {
  if (!sentiment) return null
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-2">{heading}</p>
      <div className="space-y-3">
        {SENTIMENT_WINDOWS.map((w) => (
          <SentimentWindowBlock
            key={w.key}
            label={w.label}
            text={sentiment[w.key]}
            articles={sentiment.articles?.[w.key]}
            ticker={ticker}
          />
        ))}
      </div>
    </div>
  )
}
