// Reading themes applied both to the app chrome and to the epub.js iframe content.
export const THEMES = {
  light: {
    label: '明亮',
    app: 'bg-white text-zinc-800',
    surface: 'bg-white',
    border: 'border-zinc-200',
    muted: 'text-zinc-500',
    hover: 'hover:bg-zinc-100',
    active: 'bg-violet-100 text-violet-700',
    accent: 'bg-violet-500',
    content: {
      body: { background: '#ffffff', color: '#27272a' },
      a: { color: '#7c3aed' },
    },
  },
  sepia: {
    label: '护眼',
    app: 'bg-[#f5ecd9] text-[#5b4636]',
    surface: 'bg-[#f0e6d2]',
    border: 'border-[#e0d3b8]',
    muted: 'text-[#8a7a63]',
    hover: 'hover:bg-[#e8dcc2]',
    active: 'bg-[#e0cfa8] text-[#5b4636]',
    accent: 'bg-[#a1632b]',
    content: {
      body: { background: '#f5ecd9', color: '#5b4636' },
      a: { color: '#a1632b' },
    },
  },
  dark: {
    label: '夜间',
    app: 'bg-zinc-900 text-zinc-200',
    surface: 'bg-zinc-800',
    border: 'border-zinc-700',
    muted: 'text-zinc-400',
    hover: 'hover:bg-zinc-700',
    active: 'bg-violet-500/20 text-violet-300',
    accent: 'bg-violet-500',
    content: {
      body: { background: '#18181b', color: '#d4d4d8' },
      a: { color: '#a78bfa' },
    },
  },
  // High-contrast pure black-on-white tuned for e-ink screens.
  // Uses sharp borders, no greys for chrome accents, and transitions are
  // disabled at runtime (see `.eink-mode` in style.css) to avoid ghosting.
  eink: {
    label: '墨水屏',
    app: 'bg-white text-black',
    surface: 'bg-white',
    border: 'border-black',
    muted: 'text-black',
    hover: 'hover:bg-black hover:text-white',
    active: 'bg-black text-white',
    accent: 'bg-black',
    content: {
      body: { background: '#ffffff', color: '#000000' },
      a: { color: '#000000', 'text-decoration': 'underline' },
    },
  },
}

export const THEME_KEYS = Object.keys(THEMES)
