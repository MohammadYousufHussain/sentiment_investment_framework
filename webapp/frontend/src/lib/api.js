export async function getFilters() {
  const res = await fetch('/api/filters')
  if (!res.ok) throw new Error(`getFilters failed: ${res.status}`)
  return res.json()
}

export async function getArticles(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))
  )
  const res = await fetch(`/api/articles?${qs.toString()}`)
  if (!res.ok) throw new Error(`getArticles failed: ${res.status}`)
  return res.json()
}

export async function getEntities(query) {
  const qs = new URLSearchParams({ query })
  const res = await fetch(`/api/entities?${qs.toString()}`)
  if (!res.ok) throw new Error(`getEntities failed: ${res.status}`)
  return res.json()
}

export async function searchCompanies(query) {
  const qs = new URLSearchParams({ q: query })
  const res = await fetch(`/api/company-search?${qs.toString()}`)
  if (!res.ok) throw new Error(`searchCompanies failed: ${res.status}`)
  return res.json()
}

export async function triggerStageB(tickers) {
  const res = await fetch('/api/stage-b/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
  })
  if (!res.ok) throw new Error(`triggerStageB failed: ${res.status}`)
  return res.json()
}

export async function getStageBStatus() {
  const res = await fetch('/api/stage-b/status')
  if (!res.ok) throw new Error(`getStageBStatus failed: ${res.status}`)
  return res.json()
}

export async function getCompanies() {
  const res = await fetch('/api/companies')
  if (!res.ok) throw new Error(`getCompanies failed: ${res.status}`)
  return res.json()
}

export async function getCompanyDetail(ticker) {
  const res = await fetch(`/api/companies/${encodeURIComponent(ticker)}`)
  if (!res.ok) throw new Error(`getCompanyDetail failed: ${res.status}`)
  return res.json()
}

export async function getCompanySentiment(ticker) {
  const res = await fetch(`/api/companies/${encodeURIComponent(ticker)}/sentiment`)
  if (!res.ok) throw new Error(`getCompanySentiment failed: ${res.status}`)
  return res.json()
}

/**
 * Opens the per-ticker sentiment-scoring SSE stream. onEvent receives either
 * {type: 'progress', phase, processed, total} or {type: 'complete', ...same
 * shape as getCompanySentiment}. Returns the EventSource so the caller can
 * close it.
 */
export function streamCompanySentiment(ticker, { onEvent, onError } = {}) {
  const source = new EventSource(`/api/companies/${encodeURIComponent(ticker)}/sentiment-stream`)
  source.onmessage = (event) => {
    try {
      onEvent?.(JSON.parse(event.data))
    } catch (err) {
      onError?.(err)
    }
  }
  source.onerror = (err) => onError?.(err)
  return source
}

export async function getCompanyValuation(ticker, period = 'annual') {
  const qs = new URLSearchParams({ period })
  const res = await fetch(`/api/companies/${encodeURIComponent(ticker)}/valuation?${qs.toString()}`)
  if (!res.ok) throw new Error(`getCompanyValuation failed: ${res.status}`)
  return res.json()
}

export async function getCompanyQisFactors(ticker) {
  const res = await fetch(`/api/companies/${encodeURIComponent(ticker)}/qis-factors`)
  if (!res.ok) throw new Error(`getCompanyQisFactors failed: ${res.status}`)
  return res.json()
}

export async function getCompanyHistoricalFactors(ticker) {
  const res = await fetch(`/api/companies/${encodeURIComponent(ticker)}/historical-factors`)
  if (!res.ok) throw new Error(`getCompanyHistoricalFactors failed: ${res.status}`)
  return res.json()
}

export async function getCompanySignals(ticker) {
  const res = await fetch(`/api/companies/${encodeURIComponent(ticker)}/signals`)
  if (!res.ok) throw new Error(`getCompanySignals failed: ${res.status}`)
  return res.json()
}

export async function getCompanyPeers(ticker, { refresh = false } = {}) {
  const qs = refresh ? '?refresh=true' : ''
  const res = await fetch(`/api/companies/${encodeURIComponent(ticker)}/peers${qs}`)
  if (!res.ok) throw new Error(`getCompanyPeers failed: ${res.status}`)
  return res.json()
}

export async function getComparablesRationale(ticker, peers) {
  const res = await fetch(`/api/companies/${encodeURIComponent(ticker)}/comparables-rationale`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peers }),
  })
  if (!res.ok) throw new Error(`getComparablesRationale failed: ${res.status}`)
  return res.json()
}

export async function getInvestmentThesis(ticker, { refresh = false } = {}) {
  const qs = refresh ? '?refresh=true' : ''
  const res = await fetch(`/api/companies/${encodeURIComponent(ticker)}/investment-thesis${qs}`)
  if (!res.ok) throw new Error(`getInvestmentThesis failed: ${res.status}`)
  return res.json()
}

export async function getStockPitch(ticker, stance, { refresh = false } = {}) {
  const params = new URLSearchParams()
  if (stance) params.set('stance', stance)
  if (refresh) params.set('refresh', 'true')
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`/api/companies/${encodeURIComponent(ticker)}/stock-pitch${qs}`)
  if (!res.ok) throw new Error(`getStockPitch failed: ${res.status}`)
  return res.json()
}

/**
 * Opens the Stage A search SSE stream and invokes onEvent for every message.
 * Returns the EventSource so the caller can close it.
 */
export function streamSearch(query, { maxResults = 20, onEvent, onError } = {}) {
  const qs = new URLSearchParams({ q: query, max_results: String(maxResults) })
  const source = new EventSource(`/api/search-stream?${qs.toString()}`)

  source.onmessage = (event) => {
    try {
      onEvent?.(JSON.parse(event.data))
    } catch (err) {
      onError?.(err)
    }
  }
  source.onerror = (err) => onError?.(err)

  return source
}
