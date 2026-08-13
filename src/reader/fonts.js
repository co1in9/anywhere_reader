// Reading fonts. Most entries are plain font stacks resolved by the OS; the
// PingFang SC entry ships a bundled webfont (GB2312 subset, see
// `tools/subset-fonts.py`) that is only downloaded when the user selects it.
import pingfangRegular from '../assets/fonts/PingFangSC-Regular.subset.woff2?url'
import pingfangBold from '../assets/fonts/PingFangSC-Bold.subset.woff2?url'

const SYSTEM_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'

// Absolute URLs so the rules also work inside the epub.js iframe (blob: origin).
const absolute = (url) => new URL(url, document.baseURI).href

const PINGFANG_FACES = [
  { url: pingfangRegular, weight: 400 },
  { url: pingfangBold, weight: 700 },
]

export const FONTS = {
  system: {
    label: '系统',
    family: SYSTEM_STACK,
  },
  pingfang: {
    label: '苹方',
    family: `"PingFang SC Web", ${SYSTEM_STACK}`,
    faces: PINGFANG_FACES.map((f) => ({ ...f, family: 'PingFang SC Web' })),
  },
  songti: {
    label: '宋体',
    family: '"Songti SC", "SimSun", "Noto Serif CJK SC", "Source Han Serif SC", serif',
  },
  heiti: {
    label: '黑体',
    family: '"Heiti SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif',
  },
  kaiti: {
    label: '楷体',
    family: '"Kaiti SC", "KaiTi", "STKaiti", "Noto Serif CJK SC", serif',
  },
}

export const FONT_KEYS = Object.keys(FONTS)

export function getFont(key) {
  return FONTS[key] || FONTS.system
}

// @font-face rules for the bundled faces of a font, if any.
export function fontFaceCss(key) {
  const faces = getFont(key).faces
  if (!faces) return ''
  return faces
    .map(
      (f) => `@font-face {
  font-family: "${f.family}";
  src: url("${absolute(f.url)}") format("woff2");
  font-weight: ${f.weight};
  font-style: normal;
  font-display: swap;
}`
    )
    .join('\n')
}

const loaded = new Set()

// Load a bundled font into the top-level document so the UI (and the settings
// preview) can render it. Downloads happen once, on first selection.
export async function ensureFontLoaded(key) {
  const faces = getFont(key).faces
  if (!faces || loaded.has(key) || typeof FontFace === 'undefined') return
  loaded.add(key)
  try {
    await Promise.all(
      faces.map(async (f) => {
        const face = new FontFace(f.family, `url(${absolute(f.url)}) format("woff2")`, {
          weight: String(f.weight),
          display: 'swap',
        })
        document.fonts.add(await face.load())
      })
    )
  } catch (e) {
    loaded.delete(key)
    console.warn('font load failed', e)
  }
}
