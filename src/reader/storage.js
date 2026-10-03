import { notify, errorText } from './feedback.js'

// localStorage helpers for reading preferences, per-book progress and the
// WebDAV connection config. Progress is kept as a single map so it can be
// merged with the remote `progress.json` during sync.

const PREFS_KEY = 'anywhere-reader:prefs'
const PROGRESS_KEY = 'anywhere-reader:progress'
const WEBDAV_KEY = 'anywhere-reader:webdav'

const DEFAULT_PREFS = {
  theme: 'light',
  font: 'system',
  fontSize: 100, // percent
  lineHeight: 1.7, // unitless multiplier
  layout: 'double' // 'double' (spread when wide enough) | 'single'
}

export const DEFAULT_WEBDAV = {
  url: '',
  username: '',
  password: '',
  baseDir: '/anywhere-reader',
  autoSync: true
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
    return true
  } catch (e) {
    notify('保存失败：' + errorText(e))
    return false
  }
}

export function loadPrefs() {
  const saved = { ...DEFAULT_PREFS, ...readJSON(PREFS_KEY, {}) }
  return {
    theme: ['light', 'sepia', 'dark', 'eink'].includes(saved.theme) ? saved.theme : DEFAULT_PREFS.theme,
    font: ['system', 'pingfang', 'songti', 'heiti', 'kaiti'].includes(saved.font) ? saved.font : DEFAULT_PREFS.font,
    layout: ['single', 'double'].includes(saved.layout) ? saved.layout : DEFAULT_PREFS.layout,
    fontSize: Number.isFinite(saved.fontSize) ? Math.min(200, Math.max(60, saved.fontSize)) : DEFAULT_PREFS.fontSize,
    lineHeight: Number.isFinite(saved.lineHeight) ? Math.min(2.6, Math.max(1.1, saved.lineHeight)) : DEFAULT_PREFS.lineHeight
  }
}

export function savePrefs(prefs) {
  return writeJSON(PREFS_KEY, prefs)
}

// ---- Reading progress (per book id) ----

export function loadAllProgress() {
  return readJSON(PROGRESS_KEY, {}) || {}
}

export function saveAllProgress(map) {
  return writeJSON(PROGRESS_KEY, map)
}

export function loadProgress(bookId) {
  if (!bookId) return null
  return loadAllProgress()[bookId] || null
}

export function saveProgress(bookId, { cfi, percentage }) {
  if (!bookId || !cfi) return
  const map = loadAllProgress()
  map[bookId] = {
    ...map[bookId],
    status: map[bookId]?.status === 'finished' ? 'finished' : 'reading',
    cfi,
    percentage: percentage ?? 0,
    updatedAt: Math.max(Date.now(), (map[bookId]?.updatedAt || 0) + 1)
  }
  return saveAllProgress(map) ? map[bookId] : null
}

// ---- WebDAV config ----

export function loadWebDAVConfig() {
  return { ...DEFAULT_WEBDAV, ...readJSON(WEBDAV_KEY, {}) }
}

export function saveWebDAVConfig(cfg) {
  return writeJSON(WEBDAV_KEY, { ...DEFAULT_WEBDAV, ...cfg })
}

export function setReadingStatus(bookId, status) {
  const map = loadAllProgress()
  map[bookId] = { ...map[bookId], status, updatedAt: Date.now() }
  return saveAllProgress(map)
}
export function loadBookmarks(bookId) {
  return readJSON('anywhere-reader:bookmarks', {})[bookId] || []
}
export function saveBookmarks(bookId, entries) {
  const map = readJSON('anywhere-reader:bookmarks', {})
  map[bookId] = entries
  return writeJSON('anywhere-reader:bookmarks', map)
}
export function loadAllBookmarks() {
  return readJSON('anywhere-reader:bookmarks', {})
}
export function saveAllBookmarks(map) {
  return writeJSON('anywhere-reader:bookmarks', map)
}
