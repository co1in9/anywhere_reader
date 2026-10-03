import { hashBlob, getBook, putBook, restoreBook } from './db.js'

export async function importBook(file) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  if (!zip.file('META-INF/container.xml')) throw new Error('缺少 EPUB 描述文件')
  const id = await hashBlob(file)
  const existing = await getBook(id)
  if (!existing)
    await putBook({
      id,
      name: file.name,
      title: file.name.replace(/\.epub$/i, ''),
      author: '',
      size: file.size,
      addedAt: Date.now(),
      blob: file
    })
  else if (existing.purged)
    await putBook({
      ...existing,
      blob: file,
      purged: false,
      removedAt: 0,
      removalMode: '',
      deletionUpdatedAt: Math.max(
        Date.now(),
        (existing.deletionUpdatedAt || 0) + 1
      ),
      coverFailed: false
    })
  else if (existing.removedAt) await restoreBook(id)
  return id
}
