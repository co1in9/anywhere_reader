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
  getVersionedJSON,
  putVersionedJSON
} from './webdav.js'
import { extFromMime } from './mime.js'
import { listBooks, getBook, putBook, updateBookMeta, hashBlob } from './db.js'
import { loadAllProgress, saveAllProgress } from './storage.js'

const PROGRESS_PATH = 'progress.json'

function idsFromFilenames(names, ext) {
  return names
    .filter(
      (n) =>
        n.toLowerCase().endsWith(ext) &&
        /^[a-f0-9]{16}$/.test(n.slice(0, -ext.length))
    )
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
let progressQueue = Promise.resolve()
async function mergeAndWrite(cfg) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const version = await getVersionedJSON(cfg, PROGRESS_PATH)
    // Read after the request: progress may have advanced while offline/slow.
    const merged = mergeProgress(version.value || {}, loadAllProgress())
    if (!(await putVersionedJSON(cfg, PROGRESS_PATH, merged, version))) continue
    // A page turn while PUT was pending must survive the local merge too.
    if (!saveAllProgress(mergeProgress(merged, loadAllProgress())))
      throw new Error('本地进度保存失败')
    return merged
  }
  throw new Error('进度发生并发修改，请稍后重试同步')
}
export function syncProgress(cfg) {
  const run = () =>
    navigator.locks
      ? navigator.locks.request('anywhere-reader-progress', () =>
          mergeAndWrite(cfg)
        )
      : mergeAndWrite(cfg)
  const result = progressQueue.then(run, run)
  progressQueue = result.catch(() => {})
  return result
}
export function pushProgress(cfg) {
  return syncProgress(cfg)
}

async function writeDeletion(cfg, id, marker) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const version = await getVersionedJSON(cfg, `deletions/${id}.json`)
    if (version.value?.updatedAt > marker.updatedAt) return version.value
    if (await putVersionedJSON(cfg, `deletions/${id}.json`, marker, version))
      return marker
  }
  throw new Error('书籍移除状态发生冲突，请重试同步')
}

// Full library + progress sync. Returns { pushed, pulled }.
export async function syncAll(cfg, { onStatus } = {}) {
  const status = (m) => onStatus && onStatus(m)

  status('准备目录…')
  await ensureDirs(cfg)

  const allLocal = await listBooks({ includeRemoved: true })
  // Per-book deletion markers are retained, so an offline device cannot resurrect a book.
  const deletionNames = await listDir(cfg, 'deletions')
  const remoteDeletions = new Map()
  for (const name of deletionNames.filter((n) => /^[a-f0-9]{16}\.json$/.test(n))) {
    const id = name.slice(0, -5)
    const marker = await getJSON(cfg, `deletions/${name}`)
    if (marker && (typeof marker.deleted !== 'boolean' || !Number.isFinite(marker.updatedAt))) throw new Error('云端移除标记损坏，请检查服务器文件')
    if (marker) remoteDeletions.set(id, marker)
  }
  for (const meta of allLocal) {
    const remote = remoteDeletions.get(meta.id)
    const localTime = meta.deletionUpdatedAt || 0
    if (remote && remote.updatedAt > localTime) {
      // A local-only removal is intentionally kept until explicitly restored.
      if (meta.removalMode !== 'local') {
        await updateBookMeta(meta.id, {
          removedAt: remote.deleted ? remote.updatedAt : 0,
          removalMode: remote.deleted ? 'sync' : '',
          deletionUpdatedAt: remote.updatedAt
        })
      }
    } else if (localTime && meta.removalMode !== 'local') {
      const marker = { deleted: !!meta.removedAt, updatedAt: localTime }
      const accepted = await writeDeletion(cfg, meta.id, marker)
      remoteDeletions.set(meta.id, accepted)
      if (
        accepted.updatedAt > marker.updatedAt &&
        meta.removalMode !== 'local'
      ) {
        await updateBookMeta(meta.id, {
          removedAt: accepted.deleted ? accepted.updatedAt : 0,
          removalMode: accepted.deleted ? 'sync' : '',
          deletionUpdatedAt: accepted.updatedAt
        })
      }
    }
  }
  const refreshed = await listBooks({ includeRemoved: true })
  const suppressed = new Set(
    refreshed.filter((m) => m.removedAt).map((m) => m.id)
  )
  for (const [id, marker] of remoteDeletions)
    if (marker.deleted) suppressed.add(id)
  const localMeta = refreshed.filter(
    (m) => !m.removedAt && !suppressed.has(m.id)
  )
  const localIds = new Set(localMeta.map((m) => m.id))

  status('读取云端书目…')
  const remoteNames = await listDir(cfg, 'books')
  const remoteIds = new Set(idsFromFilenames(remoteNames, '.epub'))

  let pushed = 0
  let pulled = 0

  // Upload bytes only once; send later title/thumbnail updates independently.
  for (const meta of localMeta) {
    const missing = !remoteIds.has(meta.id)
    const modified = meta.metadataUpdatedAt || meta.addedAt || 0
    if (!missing && (meta.syncedMetaAt || 0) >= modified) continue
    if (missing) {
      const record = await getBook(meta.id)
      if (!record?.blob || record.removedAt) continue
      status(`上传：${meta.title || meta.name}`)
      await putFile(
        cfg,
        `books/${meta.id}.epub`,
        record.blob,
        'application/epub+zip'
      )
      pushed++
    }
    const { cover, removedAt, removalMode, syncedMetaAt, ...rest } = meta
    await putJSON(cfg, `meta/${meta.id}.json`, { ...rest, cover: !!cover })
    if (cover)
      await putFile(
        cfg,
        `covers/${meta.id}.${extFromMime(meta.coverMime)}`,
        cover,
        meta.coverMime
      )
    await updateBookMeta(meta.id, { syncedMetaAt: modified })
  }

  // Pull remote books missing locally.
  for (const id of remoteIds) {
    if (localIds.has(id) || suppressed.has(id)) continue
    status('下载云端书籍…')
    const blob = await getFile(cfg, `books/${id}.epub`)
    if (!blob) continue
    if (await hashBlob(blob) !== id) throw new Error('云端书籍文件校验失败：' + id)
    const meta = (await getJSON(cfg, `meta/${id}.json`)) || {}
    const record = {
      id,
      name: meta.name || `${id}.epub`,
      title: meta.title || meta.name || id,
      author: meta.author || '',
      size: meta.size || blob.size,
      addedAt: meta.addedAt || Date.now(),
      metadataUpdatedAt: meta.metadataUpdatedAt || meta.addedAt || 0,
      syncedMetaAt: meta.metadataUpdatedAt || meta.addedAt || 0,
      cover: undefined,
      coverMime: meta.coverMime,
      coverFailed: meta.coverFailed || false,
      deletionUpdatedAt: remoteDeletions.get(id)?.updatedAt || 0,
      blob
    }
    if (meta.cover && meta.coverMime) {
      try {
        const ext = extFromMime(meta.coverMime)
        const coverBlob = await getFile(cfg, `covers/${id}.${ext}`)
        if (coverBlob) {
          const buffer = await coverBlob.arrayBuffer()
          record.cover = new Blob([buffer], { type: meta.coverMime })
        }
      } catch (e) {
        console.warn('download cover failed', id, e)
      }
    }
    await putBook(record)
    pulled++
  }

  status('同步进度…')
  await syncProgress(cfg)

  status('完成')
  return { pushed, pulled }
}
