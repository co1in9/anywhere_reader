// Extract the cover image from an EPUB file using JSZip.
// Caches the extracted blob locally in the book record and on WebDAV.

import JSZip from 'jszip'

export function extFromMime(mime = '') {
  const m = String(mime).toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('svg')) return 'svg'
  if (m.includes('bmp')) return 'bmp'
  return 'jpg'
}

export async function extractCover(blob) {
  try {
    const zip = await JSZip.loadAsync(blob)
    const container = await zip.file('META-INF/container.xml')?.async('text')
    if (!container) return null

    const rootfileMatch = container.match(/full-path="([^"]+)"/)
    const opfPath = rootfileMatch?.[1]
    if (!opfPath) return null

    const opfText = await zip.file(opfPath)?.async('text')
    if (!opfText) return null

    const opfDoc = new DOMParser().parseFromString(opfText, 'application/xml')
    if (opfDoc.querySelector('parsererror')) return null

    const manifestItems = [...opfDoc.querySelectorAll('manifest item')]

    // EPUB2: <meta name="cover" content="cover-id"/>
    const coverMeta = opfDoc.querySelector('metadata meta[name="cover"]')
    const coverId = coverMeta?.getAttribute('content')

    let coverItem = null
    if (coverId) {
      coverItem = manifestItems.find((i) => i.getAttribute('id') === coverId)
    }

    // EPUB3: <item properties="cover-image" .../>
    if (!coverItem) {
      coverItem = manifestItems.find((i) =>
        i.getAttribute('properties')?.includes('cover-image')
      )
    }

    // Fallback: an image whose id or href looks like a cover.
    if (!coverItem) {
      coverItem = manifestItems.find((i) => {
        const type = i.getAttribute('media-type') || ''
        const href = (i.getAttribute('href') || '').toLowerCase()
        const id = (i.getAttribute('id') || '').toLowerCase()
        return type.startsWith('image/') && (/cover/.test(id) || /cover/.test(href))
      })
    }

    if (!coverItem) return null

    const href = coverItem.getAttribute('href')
    const mime = coverItem.getAttribute('media-type') || 'image/jpeg'

    const opfDir = opfPath.split('/').slice(0, -1).join('/')
    const coverPath = opfDir ? `${opfDir}/${href}` : href

    const coverFile = zip.file(coverPath)
    if (!coverFile) return null

    const buffer = await coverFile.async('arraybuffer')
    return new Blob([buffer], { type: mime })
  } catch (e) {
    console.error('extract cover failed', e)
    return null
  }
}
