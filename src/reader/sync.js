// Two-way sync between the local library (IndexedDB + localStorage progress)
// and a WebDAV server.
//
// Remote layout (under <baseDir>):
//   books/<id>.epub      the EPUB file
//   meta/<id>.json       { id, name, title, author, size, addedAt }
//   progress.json        { [id]: { cfi, percentage, updatedAt } }

import {
  ensureDirs,
  listDir,
  putFile,
  getFile,
  putJSON,
  getJSON,
} from './webdav.js'
import { listBooks, getBook, putBook } from './db.js'
import { loadAllProgress, saveAllProgress } from './storage.js'

const PROGRESS_PATH = 'progress.json'

function idsFromFilenames(names, ext) {
  return names
    .filter((n) => n.toLowerCase().endsWith(ext))
    .map((n) => n.slice(0, -ext.length))
}

// Merge two progress maps, keeping the entry with the newer updatedAt.
export function mergeProgress(a = {}, b = {}) {
  const out = { ...a }
  for (const [id, entry] of Object.entries(b)) {
    if (!out[id] || (entry.updatedAt || 0) > (out[id].updatedAt || 0)) {
      out[id] = entry
    }
  }
  return out
}

// Pull remote progress, merge with local, write back to both sides.
export async function syncProgress(cfg) {
  const local = loadAllProgress()
  const remote = (await getJSON(cfg, PROGRESS_PATH)) || {}
  const merged = mergeProgress(local, remote)
  saveAllProgress(merged)
  await putJSON(cfg, PROGRESS_PATH, merged)
  return merged
}

// Push only the local progress map (used by the debounced auto-save in the
// reader). Still merges with remote first so other devices aren't clobbered.
export async function pushProgress(cfg) {
  return syncProgress(cfg)
}

// Full library + progress sync. Returns { pushed, pulled }.
export async function syncAll(cfg, { onStatus } = {}) {
  const status = (m) => onStatus && onStatus(m)

  status('准备目录…')
  await ensureDirs(cfg)

  const localMeta = await listBooks()
  const localIds = new Set(localMeta.map((m) => m.id))

  status('读取云端书目…')
  const remoteNames = await listDir(cfg, 'books')
  const remoteIds = new Set(idsFromFilenames(remoteNames, '.epub'))

  let pushed = 0
  let pulled = 0

  // Push local books missing on the server.
  for (const meta of localMeta) {
    if (remoteIds.has(meta.id)) continue
    const record = await getBook(meta.id)
    if (!record || !record.blob) continue
    status(`上传：${meta.title || meta.name}`)
    await putFile(
      cfg,
      `books/${meta.id}.epub`,
      record.blob,
      'application/epub+zip'
    )
    await putJSON(cfg, `meta/${meta.id}.json`, {
      id: meta.id,
      name: meta.name,
      title: meta.title,
      author: meta.author,
      size: meta.size,
      addedAt: meta.addedAt,
    })
    pushed++
  }

  // Pull remote books missing locally.
  for (const id of remoteIds) {
    if (localIds.has(id)) continue
    status('下载云端书籍…')
    const blob = await getFile(cfg, `books/${id}.epub`)
    if (!blob) continue
    const meta = (await getJSON(cfg, `meta/${id}.json`)) || {}
    await putBook({
      id,
      name: meta.name || `${id}.epub`,
      title: meta.title || meta.name || id,
      author: meta.author || '',
      size: meta.size || blob.size,
      addedAt: meta.addedAt || Date.now(),
      blob,
    })
    pulled++
  }

  status('同步进度…')
  await syncProgress(cfg)

  status('完成')
  return { pushed, pulled }
}
