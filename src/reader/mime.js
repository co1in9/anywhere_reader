export function extFromMime(mime = '') {
  const m = String(mime).toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('svg')) return 'svg'
  if (m.includes('bmp')) return 'bmp'
  return 'jpg'
}
