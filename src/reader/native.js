// Android (Capacitor) helpers. Only loaded when running inside the native app,
// so the web build never fetches this chunk.
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

const EXPORT_DIR = 'exports'
// Multiple of 3 so each chunk encodes to standalone base64.
const CHUNK = 3 * 1024 * 1024

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// WebView cannot save blob: downloads, so write the file to the app cache and
// hand it to the system share sheet (save to Files, Drive, etc.).
export async function shareBlob(blob, name) {
  await Filesystem.rmdir({
    path: EXPORT_DIR,
    directory: Directory.Cache,
    recursive: true
  }).catch(() => {})
  const path = `${EXPORT_DIR}/${name}`
  for (let offset = 0; offset === 0 || offset < blob.size; offset += CHUNK) {
    const data = await toBase64(blob.slice(offset, offset + CHUNK))
    if (offset === 0)
      await Filesystem.writeFile({
        path,
        data,
        directory: Directory.Cache,
        recursive: true
      })
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache })
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
  try {
    await Share.share({ title: name, files: [uri] })
  } catch (e) {
    if (!/cancel/i.test(e?.message || '')) throw e
  }
}
