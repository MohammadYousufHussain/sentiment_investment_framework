import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const PIPELINE = [
  { step: 'Ingest', detail: 'Financial news pulled continuously from multiple providers' },
  { step: 'Identify', detail: 'NER pins each article to the companies it is actually about' },
  { step: 'Score', detail: 'FinBERT + LLM ensemble sentiment, per article per ticker' },
  { step: 'Signal', detail: 'Time-windowed aggregation surfaces trend shifts' },
  { step: 'Thesis', detail: 'AI-written peer comparisons and investment theses' },
]

const FEATURES = [
  {
    title: 'Sentiment that names names',
    body: 'Every article is attributed to specific tickers with an ensemble of transformer NER and LLM extraction — no keyword-soup false positives. Sentiment is scored per company, not per headline.',
  },
  {
    title: 'Self-relative valuation scorecard',
    body: 'Value, Quality, Growth, and Momentum z-scores computed against each company’s own history, then blended with news sentiment into one integrated score.',
  },
  {
    title: 'Grounded AI theses',
    body: 'Peer comparisons and full investment theses written by AI — grounded strictly in the data actually collected for the ticker, never in the model’s stale pretrained memory.',
  },
]

export default function LandingPage() {
  const { user } = useAuth()
  const appHref = user ? '/search' : '/login'

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="sticky top-0 z-20 border-b border-hairline bg-page/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-series-1 shadow-[0_0_8px_var(--color-series-1)]" />
            <span className="font-semibold tracking-tight text-[15px]">Sentix</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            {user ? (
              <Link
                to="/search"
                className="rounded-md bg-series-1 text-white text-[13px] font-medium px-3.5 py-1.5 hover:brightness-110 transition"
              >
                Open app
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-[13px] font-medium text-ink-secondary hover:text-ink px-2 py-1.5 transition-colors"
                >
                  Sign in
                </Link>
                <Link
                  to="/login"
                  state={{ mode: 'signup' }}
                  className="rounded-md bg-series-1 text-white text-[13px] font-medium px-3.5 py-1.5 hover:brightness-110 transition"
                >
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 pb-14 sm:pb-20 text-center">
          <p className="text-[12px] uppercase tracking-widest text-ink-muted mb-4">
            Sentiment-driven investment research
          </p>
          <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-tight max-w-3xl mx-auto">
            Know what the news is really saying about a stock
          </h1>
          <p className="text-[15px] sm:text-base text-ink-secondary max-w-2xl mx-auto mt-5 leading-relaxed">
            Sentix ingests financial news, works out which companies each article is actually about,
            scores sentiment per ticker, and combines it with a quantitative valuation scorecard into
            AI-written investment theses — grounded in real, collected data.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to={appHref}
              className="w-full sm:w-auto rounded-md bg-series-1 text-white text-[14px] font-medium px-6 py-3 hover:brightness-110 transition"
            >
              {user ? 'Open the app' : 'Create a free account'}
            </Link>
            {!user && (
              <Link
                to="/login"
                className="w-full sm:w-auto rounded-md border border-hairline text-ink-secondary hover:text-ink hover:bg-panel text-[14px] font-medium px-6 py-3 transition-colors"
              >
                Sign in
              </Link>
            )}
          </div>
          <p className="text-[12px] text-ink-muted mt-4">Free during early access — no card required.</p>
        </section>

        <section className="border-y border-hairline bg-surface">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
            <h2 className="text-[12px] uppercase tracking-widest text-ink-muted text-center mb-8">
              How it works
            </h2>
            <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {PIPELINE.map(({ step, detail }, i) => (
                <li key={step} className="rounded-lg border border-hairline bg-panel px-4 py-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[11px] font-mono text-series-1">0{i + 1}</span>
                    <span className="text-[13px] font-semibold">{step}</span>
                  </div>
                  <p className="text-[12px] text-ink-muted leading-relaxed">{detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
            {FEATURES.map(({ title, body }) => (
              <div key={title} className="rounded-lg border border-hairline bg-surface p-5 sm:p-6">
                <h3 className="text-[15px] font-semibold tracking-tight mb-2">{title}</h3>
                <p className="text-[13px] text-ink-secondary leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-hairline">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16 text-center">
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Start researching in minutes
            </h2>
            <p className="text-[14px] text-ink-secondary mt-3 max-w-xl mx-auto">
              Search any company, trigger deep news ingestion, and get a scored, sourced view of the
              market&apos;s mood.
            </p>
            <Link
              to={appHref}
              className="inline-block mt-6 rounded-md bg-series-1 text-white text-[14px] font-medium px-6 py-3 hover:brightness-110 transition"
            >
              {user ? 'Open the app' : 'Get started free'}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-series-1" />
            <span className="text-[12px] text-ink-muted">© {new Date().getFullYear()} Sentix.ae</span>
          </div>
          <p className="text-[11px] text-ink-muted">
            Research tool — not investment advice.
          </p>
        </div>
      </footer>
    </div>
  )
}
