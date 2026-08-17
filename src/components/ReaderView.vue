<script setup>
import { ref, reactive, shallowRef, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue'
import ePub from 'epubjs'
import { THEMES, THEME_KEYS } from '../reader/themes.js'
import { FONTS, FONT_KEYS, getFont, fontFaceCss, ensureFontLoaded } from '../reader/fonts.js'
import {
  loadPrefs,
  savePrefs,
  loadProgress,
  saveProgress,
} from '../reader/storage.js'

const props = defineProps({
  // A library record: { id, name, title, author, blob }
  book: { type: Object, required: true },
})
const emit = defineEmits(['close', 'meta', 'progress'])

const viewer = ref(null)
const book = shallowRef(null)
const rendition = shallowRef(null)

const bookKey = computed(() => props.book.id)

const meta = reactive({ title: props.book.title || props.book.name, author: props.book.author || '' })
const toc = ref([])
const tocOpen = ref(true)
const settingsOpen = ref(false)
const loading = ref(true)
const errorMsg = ref('')

const progress = ref(0) // 0..100
const currentChapter = ref('')
const currentHref = ref('')
const tocEl = ref(null)
const tocItemEls = ref([])
const locationsReady = ref(false)

const prefs = reactive(loadPrefs())
const theme = computed(() => THEMES[prefs.theme] || THEMES.light)

const LAYOUTS = [
  { key: 'single', label: '单页' },
  { key: 'double', label: '双页' },
]

// epub.js spreads pages only when the viewport is wide enough, so '双页' maps to
// 'auto' rather than 'always'.
function spreadMode() {
  return prefs.layout === 'single' ? 'none' : 'auto'
}

function persistPrefs() {
  savePrefs({
    theme: prefs.theme,
    font: prefs.font,
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    layout: prefs.layout,
  })
}

function registerThemes() {
  const r = rendition.value
  if (!r) return
  for (const key of THEME_KEYS) {
    r.themes.register(key, {
      body: {
        ...THEMES[key].content.body,
        padding: '0 8px !important',
      },
      a: THEMES[key].content.a,
      '::selection': { background: 'rgba(124,58,237,0.25)' },
    })
  }
}

// The book's own stylesheet usually sets font-family and line-height on inner
// elements, so both are forced with a stylesheet injected into the epub.js
// iframe (which also carries the @font-face rules for bundled fonts).
function contentCss() {
  const rules = [
    `body, body p, body div, body li, body blockquote { line-height: ${prefs.lineHeight} !important; }`,
  ]
  if (prefs.font !== 'system') {
    rules.unshift(
      fontFaceCss(prefs.font),
      `body, body * { font-family: ${getFont(prefs.font).family} !important; }`,
    )
  }
  return rules.join('\n')
}

function applyContentCssTo(contents) {
  const doc = contents?.document
  if (!doc?.head) return
  let style = doc.getElementById(CONTENT_STYLE_ID)
  if (!style) {
    style = doc.createElement('style')
    style.id = CONTENT_STYLE_ID
    doc.head.appendChild(style)
  }
  style.textContent = contentCss()
}

function applyContentCss() {
  for (const contents of rendition.value?.getContents() || []) {
    applyContentCssTo(contents)
  }
}

function applyTheme() {
  const r = rendition.value
  if (!r) return
  r.themes.select(prefs.theme)
  r.themes.fontSize(`${prefs.fontSize}%`)
  persistPrefs()
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

// Re-laying out the views drops the current position. The iframes reflow
// asynchronously after the new styles are applied, so the location is restored
// once the layout has settled — twice, since displaying itself triggers another
// reflow.
async function reflow(mutate) {
  const r = rendition.value
  if (!r) return
  const cfi = r.currentLocation()?.start?.cfi
  try {
    mutate(r)
    if (!cfi) return
    await nextFrame()
    await r.display(cfi)
    await nextFrame()
    await r.display(cfi)
  } catch (e) {
    console.error('reflow failed', e)
  }
}

async function setLayout(key) {
  if (prefs.layout === key) return
  prefs.layout = key
  persistPrefs()
  await reflow((r) => r.spread(spreadMode()))
}

function setTheme(key) {
  prefs.theme = key
  applyTheme()
}

async function setFont(key) {
  prefs.font = key
  applyTheme()
  applyContentCss()
  await ensureFontLoaded(key)
  applyContentCss()
}

function changeFont(delta) {
  prefs.fontSize = Math.min(200, Math.max(60, prefs.fontSize + delta))
  applyTheme()
}

async function changeLineHeight(delta) {
  const next = Math.min(2.6, Math.max(1.1, Math.round((prefs.lineHeight + delta) * 10) / 10))
  if (next === prefs.lineHeight) return
  prefs.lineHeight = next
  persistPrefs()
  await reflow(applyContentCss)
}

function flattenToc(items, depth = 0, out = []) {
  for (const item of items) {
    out.push({ label: item.label.trim(), href: item.href, depth })
    if (item.subitems && item.subitems.length) {
      flattenToc(item.subitems, depth + 1, out)
    }
  }
  return out
}

async function goTo(href) {
  try {
    await rendition.value?.display(href)
  } catch (e) {
    console.error('navigate failed', e)
  }
}

function next() {
  rendition.value?.next()
}
function prev() {
  rendition.value?.prev()
}

function onKeydown(e) {
  if (e.key === 'ArrowRight') next()
  else if (e.key === 'ArrowLeft') prev()
}

let resizeObserver = null
const CONTENT_STYLE_ID = 'anywhere-reader-content'

async function setup() {
  loading.value = true
  errorMsg.value = ''
  currentHref.value = ''
  try {
    const buffer = await props.book.blob.arrayBuffer()
    const b = ePub(buffer)
    book.value = b

    const r = b.renderTo(viewer.value, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: spreadMode(),
      allowScriptedContent: true,
    })
    rendition.value = r

    registerThemes()
    r.hooks.content.register(applyContentCssTo)
    ensureFontLoaded(prefs.font).then(applyContentCss)

    const saved = loadProgress(bookKey.value)
    await r.display(saved?.cfi || undefined)
    applyTheme()
    loading.value = false

    // Metadata
    b.loaded.metadata.then((m) => {
      if (m?.title) meta.title = m.title
      if (m?.creator) meta.author = m.creator
      emit('meta', { id: bookKey.value, title: m?.title, author: m?.creator })
    })

    // Table of contents
    b.loaded.navigation.then((nav) => {
      tocItemEls.value = []
      toc.value = flattenToc(nav.toc || [])
    })

    // Generate locations for progress reporting (async, non-blocking)
    b.ready
      .then(() => b.locations.generate(1650))
      .then(() => {
        locationsReady.value = true
        const loc = r.currentLocation()
        updateProgress(loc)
        if (loc?.start?.cfi) {
          saveProgress(bookKey.value, {
            cfi: loc.start.cfi,
            percentage: progress.value,
          })
          emit('progress', { id: bookKey.value })
        }
      })
      .catch((e) => console.warn('locations generate failed', e))

    r.on('relocated', (location) => {
      updateProgress(location)
      saveProgress(bookKey.value, {
        cfi: location.start.cfi,
        percentage: progress.value,
      })
      emit('progress', { id: bookKey.value, cfi: location.start.cfi, percentage: progress.value })
      currentHref.value = location.start.href || ''
      const chap = findChapter(location.start.href)
      if (chap) currentChapter.value = chap
    })

    // Forward keyboard events from inside the epub iframe
    r.on('keydown', onKeydown)

    resizeObserver = new ResizeObserver(() => {
      try {
        r.resize()
      } catch {
        /* ignore */
      }
    })
    resizeObserver.observe(viewer.value)
  } catch (e) {
    console.error(e)
    errorMsg.value = '无法打开该 EPUB 文件，请确认文件未损坏。'
    loading.value = false
  }
}

function updateProgress(location) {
  const b = book.value
  if (!b || !location || !location.start) return
  if (locationsReady.value && b.locations.length()) {
    const pct = b.locations.percentageFromCfi(location.start.cfi)
    progress.value = Math.round((pct || 0) * 100)
  }
}

function tocIndexOf(href) {
  if (!href) return -1
  const base = href.split('#')[0]
  return toc.value.findIndex((t) => {
    const tBase = (t.href || '').split('#')[0]
    return tBase && (tBase === base || base.endsWith(tBase) || tBase.endsWith(base))
  })
}

function findChapter(href) {
  const i = tocIndexOf(href)
  return i >= 0 ? toc.value[i].label : ''
}

const activeIndex = computed(() => tocIndexOf(currentHref.value))

// Scroll the sidebar itself rather than using scrollIntoView, which would also
// scroll ancestor containers.
function scrollActiveIntoView() {
  const container = tocEl.value
  const el = tocItemEls.value[activeIndex.value]
  if (!container || !el) return
  const target = el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2
  const max = Math.max(0, container.scrollHeight - container.clientHeight)
  container.scrollTop = Math.max(0, Math.min(target, max))
}

watch([activeIndex, tocOpen], () => {
  if (tocOpen.value) nextTick(scrollActiveIntoView)
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  nextTick(setup)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (resizeObserver) resizeObserver.disconnect()
  try {
    rendition.value?.destroy()
    book.value?.destroy()
  } catch {
    /* ignore */
  }
})

watch(
  () => props.book.id,
  () => {
    try {
      rendition.value?.destroy()
      book.value?.destroy()
    } catch {
      /* ignore */
    }
    nextTick(setup)
  }
)
</script>

<template>
  <div class="flex h-full flex-col" :class="[theme.app, prefs.theme === 'eink' ? 'eink-mode' : '']">
    <!-- Top bar -->
    <header
      class="flex items-center gap-2 border-b px-3 py-2"
      :class="[theme.border, theme.surface]"
    >
      <button
        class="rounded-lg p-2 transition-colors"
        :class="theme.hover"
        title="目录"
        @click="tocOpen = !tocOpen"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <div class="min-w-0 flex-1 px-1">
        <p class="truncate text-sm font-semibold leading-tight">{{ meta.title }}</p>
        <p v-if="currentChapter" class="truncate text-xs leading-tight" :class="theme.muted">
          {{ currentChapter }}
        </p>
      </div>

      <div class="relative">
        <button
          class="rounded-lg p-2 transition-colors"
          :class="theme.hover"
          title="阅读设置"
          @click="settingsOpen = !settingsOpen"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
            <path d="M4 7h10M4 12h16M4 17h7" /><circle cx="18" cy="7" r="2" /><circle cx="15" cy="17" r="2" />
          </svg>
        </button>

        <div
          v-if="settingsOpen"
          class="absolute right-0 top-12 z-20 w-60 rounded-xl border p-4 shadow-xl"
          :class="[theme.border, theme.surface]"
        >
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide" :class="theme.muted">主题</p>
          <div class="mb-4 flex gap-2">
            <button
              v-for="key in THEME_KEYS"
              :key="key"
              class="flex-1 rounded-lg border px-2 py-1.5 text-sm transition-colors"
              :class="prefs.theme === key ? 'border-violet-500 ' + theme.active : theme.border + ' ' + theme.hover"
              @click="setTheme(key)"
            >
              {{ THEMES[key].label }}
            </button>
          </div>

          <p class="mb-2 text-xs font-semibold uppercase tracking-wide" :class="theme.muted">字体</p>
          <div class="mb-4 grid grid-cols-2 gap-2">
            <button
              v-for="key in FONT_KEYS"
              :key="key"
              class="rounded-lg border px-2 py-1.5 text-sm transition-colors"
              :class="prefs.font === key ? 'border-violet-500 ' + theme.active : theme.border + ' ' + theme.hover"
              :style="{ fontFamily: FONTS[key].family }"
              @click="setFont(key)"
            >
              {{ FONTS[key].label }}
            </button>
          </div>

          <p class="mb-2 text-xs font-semibold uppercase tracking-wide" :class="theme.muted">布局</p>
          <div class="mb-4 flex gap-2">
            <button
              v-for="item in LAYOUTS"
              :key="item.key"
              class="flex-1 rounded-lg border px-2 py-1.5 text-sm transition-colors"
              :class="prefs.layout === item.key ? 'border-violet-500 ' + theme.active : theme.border + ' ' + theme.hover"
              @click="setLayout(item.key)"
            >
              {{ item.label }}
            </button>
          </div>

          <p class="mb-2 text-xs font-semibold uppercase tracking-wide" :class="theme.muted">字号</p>
          <div class="mb-4 flex items-center gap-2">
            <button class="flex-1 rounded-lg border py-1.5 text-lg transition-colors" :class="[theme.border, theme.hover]" @click="changeFont(-10)">A−</button>
            <span class="w-14 text-center text-sm tabular-nums">{{ prefs.fontSize }}%</span>
            <button class="flex-1 rounded-lg border py-1.5 text-lg transition-colors" :class="[theme.border, theme.hover]" @click="changeFont(10)">A+</button>
          </div>

          <p class="mb-2 text-xs font-semibold uppercase tracking-wide" :class="theme.muted">行距</p>
          <div class="flex items-center gap-2">
            <button class="flex-1 rounded-lg border py-1.5 text-lg transition-colors" :class="[theme.border, theme.hover]" @click="changeLineHeight(-0.1)">−</button>
            <span class="w-14 text-center text-sm tabular-nums">{{ prefs.lineHeight.toFixed(1) }}</span>
            <button class="flex-1 rounded-lg border py-1.5 text-lg transition-colors" :class="[theme.border, theme.hover]" @click="changeLineHeight(0.1)">+</button>
          </div>
        </div>
      </div>

      <button
        class="rounded-lg p-2 transition-colors"
        :class="theme.hover"
        title="关闭书籍"
        @click="emit('close')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </header>

    <!-- Body -->
    <div class="flex min-h-0 flex-1">
      <!-- TOC sidebar -->
      <aside
        v-show="tocOpen"
        ref="tocEl"
        class="toc-scroll w-64 shrink-0 overflow-y-auto border-r"
        :class="[theme.border, theme.surface]"
      >
        <p class="px-4 py-3 text-xs font-semibold uppercase tracking-wide" :class="theme.muted">目录</p>
        <nav class="pb-6">
          <button
            v-for="(item, i) in toc"
            :key="i"
            :ref="(el) => (tocItemEls[i] = el)"
            class="block w-full truncate px-4 py-2 text-left text-sm transition-colors"
            :class="[
              theme.hover,
              activeIndex === i ? theme.active : '',
            ]"
            :style="{ paddingLeft: 16 + item.depth * 14 + 'px' }"
            :title="item.label"
            @click="goTo(item.href)"
          >
            {{ item.label || '—' }}
          </button>
          <p v-if="!toc.length" class="px-4 py-2 text-sm" :class="theme.muted">无目录信息</p>
        </nav>
      </aside>

      <!-- Reading area -->
      <main class="relative min-w-0 flex-1">
        <div ref="viewer" class="absolute inset-0"></div>

        <!-- click zones for prev/next -->
        <button
          class="absolute inset-y-0 left-0 z-10 w-[12%] cursor-w-resize bg-transparent"
          title="上一页"
          @click="prev"
        ></button>
        <button
          class="absolute inset-y-0 right-0 z-10 w-[12%] cursor-e-resize bg-transparent"
          title="下一页"
          @click="next"
        ></button>

        <!-- loading / error overlay -->
        <div
          v-if="loading || errorMsg"
          class="absolute inset-0 z-30 flex items-center justify-center"
          :class="theme.surface"
        >
          <div v-if="errorMsg" class="px-6 text-center">
            <p class="font-medium text-red-500">{{ errorMsg }}</p>
            <button class="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm text-white" @click="emit('close')">返回</button>
          </div>
          <div v-else class="flex items-center gap-3" :class="theme.muted">
            <svg class="h-6 w-6 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
            </svg>
            <span>正在解析电子书…</span>
          </div>
        </div>
      </main>
    </div>

    <!-- Footer / progress -->
    <footer
      class="flex items-center gap-3 border-t px-4 py-2 text-xs"
      :class="[theme.border, theme.surface, theme.muted]"
    >
      <button class="rounded p-1 transition-colors" :class="theme.hover" title="上一页" @click="prev">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-300/40">
        <div class="h-full rounded-full transition-all" :class="theme.accent" :style="{ width: progress + '%' }"></div>
      </div>
      <button class="rounded p-1 transition-colors" :class="theme.hover" title="下一页" @click="next">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><polyline points="9 18 15 12 9 6" /></svg>
      </button>
      <span class="w-10 text-right tabular-nums">{{ locationsReady ? progress + '%' : '…' }}</span>
    </footer>
  </div>
</template>
