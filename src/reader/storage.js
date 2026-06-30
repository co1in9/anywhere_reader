// localStorage helpers for reading preferences, per-book progress and the
// WebDAV connection config. Progress is kept as a single map so it can be
// merged with the remote `progress.json` during sync.

const PREFS_KEY = 'anywhere-reader:prefs'
const PROGRESS_KEY = 'anywhere-reader:progress'
const WEBDAV_KEY = 'anywhere-reader:webdav'

const DEFAULT_PREFS = {
  theme: 'light',
  fontSize: 100, // percent
}

export const DEFAULT_WEBDAV = {
  url: '',
  username: '',
  password: '',
  baseDir: '/anywhere-reader',
  autoSync: true,
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable — ignore */
  }
}

export function loadPrefs() {
  return { ...DEFAULT_PREFS, ...readJSON(PREFS_KEY, {}) }
}

export function savePrefs(prefs) {
  writeJSON(PREFS_KEY, prefs)
}

// ---- Reading progress (per book id) ----

export function loadAllProgress() {
  return readJSON(PROGRESS_KEY, {}) || {}
}

export function saveAllProgress(map) {
  writeJSON(PROGRESS_KEY, map)
}

export function loadProgress(bookId) {
  if (!bookId) return null
  return loadAllProgress()[bookId] || null
}

export function saveProgress(bookId, { cfi, percentage }) {
  if (!bookId || !cfi) return
  const map = loadAllProgress()
  map[bookId] = { cfi, percentage: percentage ?? 0, updatedAt: Date.now() }
  saveAllProgress(map)
  return map[bookId]
}

// ---- WebDAV config ----

export function loadWebDAVConfig() {
  return { ...DEFAULT_WEBDAV, ...readJSON(WEBDAV_KEY, {}) }
}

export function saveWebDAVConfig(cfg) {
  writeJSON(WEBDAV_KEY, { ...DEFAULT_WEBDAV, ...cfg })
}
