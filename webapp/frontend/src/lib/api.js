// Shared fetch wrapper. On a 401 from any data endpoint it broadcasts
// 'auth:unauthorized' so AuthProvider (lib/auth.jsx) can drop the session and
// the router can bounce to /login -- individual pages don't handle auth.
async function request(name, path, options = undefined) {
  const res = await fetch(path, options)
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    window.dispatchEvent(new Event('auth:unauthorized'))
  }
  if (!res.ok) throw new Error(`${name} failed: ${res.status}`)
  return res.json()
}

function post(name, path, body) {
  return request(name, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// -- Auth -------------------------------------------------------------------

export async function getCurrentUser() {
  const res = await fetch('/api/auth/me')
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`getCurrentUser failed: ${res.status}`)
  return (await res.json()).user
}

export async function authSignup({ name, email, password }) {
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Signup failed: ${res.status}`)
  return data.user
}

export async function authLogin({ email, password }) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Login failed: ${res.status}`)
  return data.user
}

export async function authLogout() {
  await fetch('/api/auth/logout', { method: 'POST' })
}

// -- Data endpoints ---------------------------------------------------------

export function getFilters() {
  return request('getFilters', '/api/filters')
}

export function getArticles(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))
  )
  return request('getArticles', `/api/articles?${qs.toString()}`)
}

export function getEntities(query) {
  const qs = new URLSearchParams({ query })
  return request('getEntities', `/api/entities?${qs.toString()}`)
}

export function searchCompanies(query) {
  const qs = new URLSearchParams({ q: query })
  return request('searchCompanies', `/api/company-search?${qs.toString()}`)
}

export function triggerStageB(tickers) {
  return post('triggerStageB', '/api/stage-b/trigger', { tickers })
}

export function getStageBStatus() {
  return request('getStageBStatus', '/api/stage-b/status')
}

export function getCompanies() {
  return request('getCompanies', '/api/companies')
}

export function getCompanyDetail(ticker) {
  return request('getCompanyDetail', `/api/companies/${encodeURIComponent(ticker)}`)
}

export function getCompanySentiment(ticker) {
  return request('getCompanySentiment', `/api/companies/${encodeURIComponent(ticker)}/sentiment`)
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

export function getCompanyValuation(ticker, period = 'annual') {
  const qs = new URLSearchParams({ period })
  return request('getCompanyValuation', `/api/companies/${encodeURIComponent(ticker)}/valuation?${qs.toString()}`)
}

export function getCompanyQisFactors(ticker) {
  return request('getCompanyQisFactors', `/api/companies/${encodeURIComponent(ticker)}/qis-factors`)
}

export function getCompanyHistoricalFactors(ticker) {
  return request('getCompanyHistoricalFactors', `/api/companies/${encodeURIComponent(ticker)}/historical-factors`)
}

export function getCompanySignals(ticker) {
  return request('getCompanySignals', `/api/companies/${encodeURIComponent(ticker)}/signals`)
}

export function getCompanyPeers(ticker, { refresh = false } = {}) {
  const qs = refresh ? '?refresh=true' : ''
  return request('getCompanyPeers', `/api/companies/${encodeURIComponent(ticker)}/peers${qs}`)
}

export function getComparablesRationale(ticker, peers) {
  return post('getComparablesRationale', `/api/companies/${encodeURIComponent(ticker)}/comparables-rationale`, { peers })
}

export function getInvestmentThesis(ticker, { refresh = false } = {}) {
  const qs = refresh ? '?refresh=true' : ''
  return request('getInvestmentThesis', `/api/companies/${encodeURIComponent(ticker)}/investment-thesis${qs}`)
}

export function getStockPitch(ticker, stance, { refresh = false } = {}) {
  const params = new URLSearchParams()
  if (stance) params.set('stance', stance)
  if (refresh) params.set('refresh', 'true')
  const qs = params.toString() ? `?${params.toString()}` : ''
  return request('getStockPitch', `/api/companies/${encodeURIComponent(ticker)}/stock-pitch${qs}`)
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
