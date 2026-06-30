// Lightweight localStorage helpers for persisting reading progress & preferences.

const PREFS_KEY = 'anywhere-reader:prefs'
const LOCATION_PREFIX = 'anywhere-reader:loc:'

const DEFAULT_PREFS = {
  theme: 'light',
  fontSize: 100, // percent
}

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage unavailable — ignore */
  }
}

export function loadLocation(bookKey) {
  if (!bookKey) return null
  try {
    return localStorage.getItem(LOCATION_PREFIX + bookKey) || null
  } catch {
    return null
  }
}

export function saveLocation(bookKey, cfi) {
  if (!bookKey || !cfi) return
  try {
    localStorage.setItem(LOCATION_PREFIX + bookKey, cfi)
  } catch {
    /* ignore */
  }
}
