import { listBooks, getBook, putBook, hashBlob } from './db.js'
import {
  loadAllProgress,
  saveAllProgress,
  loadPrefs,
  savePrefs,
  loadAllBookmarks,
  saveAllBookmarks
} from './storage.js'
import { mergeProgress } from './sync.js'

export async function exportBackup(onStatus = () => {}) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const metas = (await listBooks({ includeRemoved: true })).filter(
    (b) => !b.purged
  )
  const records = []
  for (const [index, meta] of metas.entries()) {
    onStatus(`打包书籍 ${index + 1}/${metas.length}`)
    const record = await getBook(meta.id)
    if (!record?.blob) throw new Error('书籍文件缺失：' + meta.title)
    const { cover, ...data } = meta
    records.push(data)
    zip.file(`books/${meta.id}.epub`, await record.blob.arrayBuffer())
  }
  zip.file(
    'manifest.json',
    JSON.stringify({
      format: 'anywhere-reader-backup',
      version: 1,
      books: records,
      progress: loadAllProgress(),
      prefs: loadPrefs(),
      bookmarks: loadAllBookmarks()
    })
  )
  // Credentials deliberately never enter a portable backup.
  return zip.generateAsync({ type: 'blob', compression: 'STORE' })
}
export async function importBackup(file, onStatus = () => {}) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)
  const manifest = JSON.parse(
    (await zip.file('manifest.json')?.async('text')) || 'null'
  )
  if (
    manifest?.format !== 'anywhere-reader-backup' ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.books)
  )
    throw new Error('这不是有效的 Anywhere Reader 备份')
  const records = []
  // Validate all book contents before touching the current library.
  for (const [index, meta] of manifest.books.entries()) {
    onStatus(`校验书籍 ${index + 1}/${manifest.books.length}`)
    if (!/^[a-f0-9]{16}$/.test(meta.id)) throw new Error('备份中的书籍编号无效')
    const entry = zip.file(`books/${meta.id}.epub`)
    if (!entry) throw new Error('备份缺少书籍文件')
    const blob = new Blob([await entry.async('arraybuffer')], {
      type: 'application/epub+zip'
    })
    if ((await hashBlob(blob)) !== meta.id)
      throw new Error('备份中的书籍文件校验失败')
    records.push({
      id: meta.id,
      name: String(meta.name || `${meta.id}.epub`),
      title: String(meta.title || meta.name || ''),
      author: String(meta.author || ''),
      addedAt: Number(meta.addedAt) || Date.now(),
      size: blob.size,
      blob,
      purged: false,
      removedAt: meta.removedAt ? Date.now() : 0,
      removalMode: meta.removedAt ? 'local' : '',
      deletionUpdatedAt: Date.now(),
      coverFailed: false
    })
  }
  for (const record of records) await putBook(record)
  const progress = Object.fromEntries(
    Object.entries(manifest.progress || {}).filter(
      ([id, p]) =>
        /^[a-f0-9]{16}$/.test(id) &&
        p &&
        typeof p.cfi === 'string' &&
        Number.isFinite(p.updatedAt)
    )
  )
  if (!saveAllProgress(mergeProgress(progress, loadAllProgress())))
    throw new Error('备份进度保存失败')
  const bookmarks = loadAllBookmarks()
  for (const [id, entries] of Object.entries(manifest.bookmarks || {})) {
    if (!/^[a-f0-9]{16}$/.test(id) || !Array.isArray(entries)) continue
    bookmarks[id] = [
      ...new Map(
        [
          ...(bookmarks[id] || []),
          ...entries.filter((e) => typeof e?.cfi === 'string')
        ].map((e) => [e.cfi, e])
      ).values()
    ]
  }
  if (!saveAllBookmarks(bookmarks)) throw new Error('备份书签保存失败')
  const p = manifest.prefs
  if (
    p &&
    ['light', 'sepia', 'dark', 'eink'].includes(p.theme) &&
    Number.isFinite(p.fontSize) &&
    Number.isFinite(p.lineHeight)
  ) {
    savePrefs({
      ...loadPrefs(),
      ...p,
      fontSize: Math.min(200, Math.max(60, p.fontSize)),
      lineHeight: Math.min(2.6, Math.max(1.1, p.lineHeight))
    })
  }
  return records.length
}
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
