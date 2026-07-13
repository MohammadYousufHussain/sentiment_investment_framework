// Cross-page weight persistence, backed by localStorage so it survives both
// SPA navigation (switching tabs/companies) and a hard browser refresh.
// Deliberately NOT tied to a specific ticker -- like the existing per-page
// weight state it replaces, the weighting scheme is a user preference, not
// a per-company setting.
//
// This is a one-way "lock and carry forward" flow, not a live two-way sync:
// Quantitative Valuation and Integrated Scoring each have their own
// free-editing local state as before: nothing here changes moment-to-moment
// as you type. Only clicking that page's "Lock weights" button snapshots
// the current values here, where Comparables (and, for factor/window
// weights, Integrated Scoring on a fresh visit) picks them up as its
// starting point -- still fully editable from there, never forced back to
// the locked value.
const PREFIX = 'sentinel.weights.'

function readStored(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage unavailable (private browsing, quota, etc.) -- the lock
    // silently becomes session-only rather than failing the click.
  }
}

// {value: {metricKey: weight}, quality: {...}, growth: {...}, momentum: {...}}
// -- set from the Quantitative Valuation tab.
export function getLockedMetricWeights() {
  return readStored('metricWeights')
}
export function lockMetricWeights(metricWeights) {
  writeStored('metricWeights', metricWeights)
}

// {value, quality, growth, momentum, sentiment} -- set from Integrated Scoring.
export function getLockedFactorWeights() {
  return readStored('factorWeights')
}

// {recent, mid, historical} -- set from Integrated Scoring.
export function getLockedSentimentWindowWeights() {
  return readStored('sentimentWindowWeights')
}

export function lockFactorAndSentimentWeights(factorWeights, sentimentWindowWeights) {
  writeStored('factorWeights', factorWeights)
  writeStored('sentimentWindowWeights', sentimentWindowWeights)
}
