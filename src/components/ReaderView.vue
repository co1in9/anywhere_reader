<script setup>
import {
  ref,
  reactive,
  shallowRef,
  onMounted,
  onBeforeUnmount,
  watch,
  computed,
  nextTick
} from 'vue'
import ePub from 'epubjs'
import ConfirmDialog from './ConfirmDialog.vue'
import { getLocations, putLocations } from '../reader/db.js'
import { notify, errorText } from '../reader/feedback.js'
import { THEMES, THEME_KEYS } from '../reader/themes.js'
import {
  FONTS,
  FONT_KEYS,
  getFont,
  fontFaceCss,
  ensureFontLoaded
} from '../reader/fonts.js'
import {
  loadPrefs,
  savePrefs,
  loadProgress,
  saveProgress,
  loadBookmarks,
  saveBookmarks
} from '../reader/storage.js'

const props = defineProps({
  // A library record: { id, name, title, author, blob }
  book: { type: Object, required: true },
  sync: {
    type: Object,
    default: () => ({ running: false, error: '', message: '' })
  }
})
const emit = defineEmits(['close', 'meta', 'progress', 'sync'])

const viewer = ref(null)
const book = shallowRef(null)
const rendition = shallowRef(null)

const bookKey = computed(() => props.book.id)

const meta = reactive({
  title: props.book.title || props.book.name,
  author: props.book.author || ''
})
const toc = ref([])
const mobile = ref(window.matchMedia('(max-width: 639px)').matches)
const tocOpen = ref(!mobile.value)
const toolbarVisible = ref(true)
const bookmarkOpen = ref(false)
const bookmarks = ref(loadBookmarks(props.book.id))
const jumpBack = ref('')
const externalLink = ref('')
const searchOpen = ref(false)
const searchQuery = ref('')
const searchResults = ref([])
const searching = ref(false)
let session = 0
let searchSession = 0
let touchStart = null
let lastSwipeAt = 0
const savedState = ref('等待保存')
let reflowQueue = Promise.resolve()
const INDEX_VERSION = 'epubjs-0.3.93-1650-v1'
const media = window.matchMedia('(max-width: 639px)')
function onViewport(e) {
  mobile.value = e.matches
  tocOpen.value = !e.matches
}
function addBookmark() {
  const cfi = rendition.value?.currentLocation()?.start?.cfi
  if (!cfi || bookmarks.value.some((b) => b.cfi === cfi)) return
  const entries = [
    ...bookmarks.value,
    {
      cfi,
      label: currentChapter.value || '书签',
      percentage: progress.value,
      addedAt: Date.now()
    }
  ]
  if (saveBookmarks(bookKey.value, entries)) bookmarks.value = entries
}
function removeBookmark(cfi) {
  const entries = bookmarks.value.filter((b) => b.cfi !== cfi)
  if (saveBookmarks(bookKey.value, entries)) bookmarks.value = entries
}
async function searchBook() {
  const query = searchQuery.value.trim()
  const b = book.value
  const token = ++searchSession
  searchResults.value = []
  if (!query || !b) return
  searching.value = true
  try {
    for (const section of b.spine.spineItems) {
      if (token !== searchSession || b !== book.value) return
      // Release each search document, without unloading an active rendered section.
      const wasLoaded = !!section.document
      await section.load(b.load.bind(b))
      if (token !== searchSession || b !== book.value) return
      searchResults.value.push(
        ...section.find(query).slice(0, 100 - searchResults.value.length)
      )
      if (!wasLoaded) section.unload()
      if (searchResults.value.length >= 100) break
      await nextFrame()
    }
  } catch (e) {
    if (token === searchSession) notify('搜索失败：' + errorText(e))
  } finally {
    if (token === searchSession) searching.value = false
  }
}
function onTouchStart(e) {
  if (e.touches?.length === 1)
    touchStart = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now()
    }
}
function onTouchEnd(e) {
  const end = e.changedTouches?.[0]
  const start = touchStart
  touchStart = null
  if (
    !start ||
    !end ||
    Date.now() - start.time > 600 ||
    e.view?.getSelection?.()?.toString()
  )
    return
  const dx = end.clientX - start.x
  const dy = end.clientY - start.y
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) {
    dx < 0 ? next() : prev()
    lastSwipeAt = Date.now()
  }
}
function onContentClick(e) {
  if (Date.now() - lastSwipeAt < 400) return
  if (
    settingsOpen.value ||
    bookmarkOpen.value ||
    searchOpen.value ||
    (tocOpen.value && mobile.value)
  )
    return
  if (
    e.target.closest?.('a,button,input,textarea,select') ||
    e.view?.getSelection?.()?.toString()
  )
    return
  const width = e.view?.innerWidth || viewer.value?.clientWidth
  if (e.clientX > width * 0.25 && e.clientX < width * 0.75)
    toolbarVisible.value = !toolbarVisible.value
}
function toggleSearch() {
  searchOpen.value = !searchOpen.value
  bookmarkOpen.value = false
  toolbarVisible.value = true
}
function toggleBookmarks() {
  bookmarkOpen.value = !bookmarkOpen.value
  searchOpen.value = false
  toolbarVisible.value = true
}
function closePanels() {
  bookmarkOpen.value = false
  searchOpen.value = false
  searchSession++
}
async function returnToPosition() {
  const cfi = jumpBack.value
  jumpBack.value = ''
  try { await rendition.value.display(cfi) } catch (e) { notify(errorText(e)) }
}
function openExternal() {
  window.open(externalLink.value, '_blank', 'noopener,noreferrer')
  externalLink.value = ''
}
const watchedDocuments = new WeakSet()
function watchExternalLinks(doc) {
  if (watchedDocuments.has(doc)) return
  watchedDocuments.add(doc)
  doc.addEventListener(
    'click',
    (event) => {
      const anchor = event.target.closest?.('a[href]')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (/^(https?:|mailto:)/i.test(href)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        externalLink.value = href
      }
    },
    true
  )
}
function isolateContent(doc) {
  const head = doc?.head || doc?.querySelector('head')
  if (!head) return
  const policy = doc.createElement('meta')
  policy.setAttribute('http-equiv', 'Content-Security-Policy')
  policy.setAttribute('content',
    "default-src 'none'; img-src 'self' blob: data:; style-src 'self' blob: data: 'unsafe-inline'; font-src 'self' blob: data:; media-src blob: data:; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'")
  head.prepend(policy)

}

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
  { key: 'double', label: '双页' }
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
    layout: prefs.layout
  })
}

function registerThemes() {
  const r = rendition.value
  if (!r) return
  for (const key of THEME_KEYS) {
    r.themes.register(key, {
      body: {
        ...THEMES[key].content.body,
        padding: '0 8px !important'
      },
      a: THEMES[key].content.a,
      '::selection': { background: 'rgba(124,58,237,0.25)' }
    })
  }
}

// The book's own stylesheet usually sets font-family and line-height on inner
// elements, so both are forced with a stylesheet injected into the epub.js
// iframe (which also carries the @font-face rules for bundled fonts).
function contentCss() {
  const rules = [
    `body, body p, body div, body li, body blockquote { line-height: ${prefs.lineHeight} !important; }`
  ]
  if (prefs.font !== 'system') {
    rules.unshift(
      fontFaceCss(prefs.font),
      `body, body * { font-family: ${getFont(prefs.font).family} !important; }`
    )
  }
  return rules.join('\n')
}

function applyContentCssTo(contents) {
  const doc = contents?.document
  if (!doc?.head) return
  watchExternalLinks(doc)
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
function reflow(mutate) {
  const r = rendition.value
  const token = session
  const task = reflowQueue
    .catch(() => {})
    .then(async () => {
      if (!r || r !== rendition.value || token !== session) return
      const cfi = r.currentLocation()?.start?.cfi
      mutate(r)
      if (!cfi) return
      await nextFrame()
      if (token !== session) return
      await r.display(cfi)
    })
    .catch((e) => {
      if (token === session) notify('排版调整失败：' + errorText(e))
    })
  reflowQueue = task
  return task
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
  persistPrefs()
  await ensureFontLoaded(key)
  if (prefs.font === key)
    await reflow(() => {
      applyTheme()
      applyContentCss()
    })
}

function changeFont(delta) {
  prefs.fontSize = Math.min(200, Math.max(60, prefs.fontSize + delta))
  reflow(applyTheme)
}

async function changeLineHeight(delta) {
  const next = Math.min(
    2.6,
    Math.max(1.1, Math.round((prefs.lineHeight + delta) * 10) / 10)
  )
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
    const r = rendition.value
    if (!r) return
    const original = r.currentLocation()?.start?.cfi
    await r.display(href)
    jumpBack.value = original || ''
    if (mobile.value) tocOpen.value = false
    bookmarkOpen.value = false
    searchOpen.value = false
  } catch (e) {
    notify('跳转失败：' + errorText(e))
  }
}

function next(event) {
  if (event?.type === 'click' && Date.now() - lastSwipeAt < 400) return
  rendition.value?.next()?.catch((e) => notify('翻页失败：' + errorText(e)))
}
function prev(event) {
  if (event?.type === 'click' && Date.now() - lastSwipeAt < 400) return
  rendition.value?.prev()?.catch((e) => notify('翻页失败：' + errorText(e)))
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    tocOpen.value = false
    settingsOpen.value = false
    bookmarkOpen.value = false
    searchOpen.value = false
    toolbarVisible.value = true
    return
  }
  if (
    e.target?.closest?.('input,textarea,select,[contenteditable]') ||
    e.altKey ||
    e.ctrlKey ||
    e.metaKey ||
    settingsOpen.value
  )
    return
  if (e.key === 'ArrowRight') next()
  else if (e.key === 'ArrowLeft') prev()
}

let resizeObserver = null
let resizeFrame = null
const CONTENT_STYLE_ID = 'anywhere-reader-content'

async function setup() {
  loading.value = true
  errorMsg.value = ''
  currentHref.value = ''
  currentChapter.value = ''
  locationsReady.value = false
  toc.value = []
  const token = ++session
  const id = props.book.id
  const alive = () => token === session
  bookmarks.value = loadBookmarks(id)
  progress.value = loadProgress(id)?.percentage || 0
  try {
    const buffer = await props.book.blob.arrayBuffer()
    if (!alive()) return
    const b = ePub(buffer)
    b.spine.hooks.content.register(isolateContent)
    book.value = b

    const r = b.renderTo(viewer.value, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: spreadMode(),
      allowScriptedContent: false,
      allowPopups: false
    })
    rendition.value = r

    registerThemes()
    r.hooks.content.register(applyContentCssTo)
    ensureFontLoaded(prefs.font)
      .then(() => {
        if (alive()) applyContentCss()
      })
      .catch((e) => {
        if (alive()) notify(errorText(e))
      })

    const saved = loadProgress(bookKey.value)
    try {
      await r.display(saved?.cfi || undefined)
    } catch (e) {
      if (!saved?.cfi) throw e
      await r.display()
      notify('原阅读位置已失效，已返回书籍开头。', 'info')
    }
    if (!alive()) return
    applyTheme()
    loading.value = false

    // Metadata
    b.loaded.metadata
      .then((m) => {
        if (!alive()) return
        if (m?.title) meta.title = m.title
        if (m?.creator) meta.author = m.creator
        emit('meta', { id, title: m?.title, author: m?.creator })
      })
      .catch((e) => {
        if (alive()) notify('书籍信息读取失败：' + errorText(e))
      })

    // Table of contents
    b.loaded.navigation
      .then((nav) => {
        if (!alive()) return
        tocItemEls.value = []
        toc.value = flattenToc(nav.toc || [])
        currentHref.value = r.currentLocation()?.start?.href || ''
        currentChapter.value = findChapter(currentHref.value)
      })
      .catch((e) => {
        if (alive()) notify('目录读取失败：' + errorText(e))
      })

    // Generate locations for progress reporting (async, non-blocking)
    b.ready
      .then(async () => {
        const cached = await getLocations(id)
        if (!alive()) return
        if (cached?.version === INDEX_VERSION) b.locations.load(cached.data)
        else {
          await b.locations.generate(1650)
          if (!alive()) return
          await putLocations(id, {
            version: INDEX_VERSION,
            data: b.locations.save()
          })
        }
      })
      .then(() => {
        if (!alive()) return
        locationsReady.value = true
        const loc = r.currentLocation()
        updateProgress(loc)
        if (loc?.start?.cfi) {
          const savedEntry = saveProgress(id, {
            cfi: loc.start.cfi,
            percentage: progress.value
          })
          savedState.value = savedEntry ? '本地已保存' : '本地保存失败'
          if (savedEntry) emit('progress', { id })
        }
      })
      .catch((e) => {
        if (alive()) notify('阅读索引生成失败：' + errorText(e))
      })

    r.on('relocated', (location) => {
      if (!alive()) return
      updateProgress(location)
      const savedEntry = saveProgress(id, {
        cfi: location.start.cfi,
        percentage: progress.value
      })
      savedState.value = savedEntry ? '本地已保存' : '本地保存失败'
      if (savedEntry)
        emit('progress', {
          id,
          cfi: location.start.cfi,
          percentage: progress.value
        })
      currentHref.value = location.start.href || ''
      const chap = findChapter(location.start.href)
      if (chap) currentChapter.value = chap
    })

    // Forward keyboard events from inside the epub iframe
    r.on('keydown', onKeydown)
    r.on('touchstart', onTouchStart)
    r.on('touchend', onTouchEnd)
    r.on('click', onContentClick)

    resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        if (alive()) reflow((view) => view.resize())
      })
    })
    resizeObserver.observe(viewer.value)
  } catch (e) {
    if (!alive()) return
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
    return (
      tBase && (tBase === base || base.endsWith(tBase) || tBase.endsWith(base))
    )
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
  media.addEventListener('change', onViewport)
  nextTick(setup)
})

onBeforeUnmount(() => {
  session++
  searchSession++
  cancelAnimationFrame(resizeFrame)
  window.removeEventListener('keydown', onKeydown)
  media.removeEventListener('change', onViewport)
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
    session++
    searchSession++
    resizeObserver?.disconnect()
    cancelAnimationFrame(resizeFrame)
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
  <div
    class="flex h-full flex-col"
    :class="[theme.app, prefs.theme === 'eink' ? 'eink-mode' : '']"
  >
    <ConfirmDialog
      v-if="externalLink"
      title="打开书中的外部链接？"
      :message="externalLink"
      :actions="[{ value: 'open', label: '在新窗口打开' }]"
      @close="externalLink = ''"
      @choose="openExternal"
    />
    <!-- Top bar -->
    <header
      v-show="toolbarVisible"
      class="reader-header flex items-center gap-2 border-b px-3 py-2"
      :class="[theme.border, theme.surface]"
    >
      <button
        class="rounded-lg p-2 transition-colors"
        :class="theme.hover"
        title="目录"
        aria-label="目录"
        :aria-expanded="tocOpen"
        @click="tocOpen = !tocOpen"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-5 w-5"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <div class="min-w-0 flex-1 px-1">
        <p class="truncate text-sm font-semibold leading-tight">
          {{ meta.title }}
        </p>
        <p
          v-if="currentChapter"
          class="truncate text-xs leading-tight"
          :class="theme.muted"
        >
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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-5 w-5"
          >
            <path d="M4 7h10M4 12h16M4 17h7" />
            <circle cx="18" cy="7" r="2" />
            <circle cx="15" cy="17" r="2" />
          </svg>
        </button>

        <div
          v-if="settingsOpen"
          class="absolute right-0 top-12 z-20 w-60 rounded-xl border p-4 shadow-xl"
          :class="[theme.border, theme.surface]"
        >
          <p
            class="mb-2 text-xs font-semibold uppercase tracking-wide"
            :class="theme.muted"
          >
            主题
          </p>
          <div class="mb-4 flex gap-2">
            <button
              v-for="key in THEME_KEYS"
              :key="key"
              class="flex-1 rounded-lg border px-2 py-1.5 text-sm transition-colors"
              :class="
                prefs.theme === key
                  ? 'border-violet-500 ' + theme.active
                  : theme.border + ' ' + theme.hover
              "
              @click="setTheme(key)"
            >
              {{ THEMES[key].label }}
            </button>
          </div>

          <p
            class="mb-2 text-xs font-semibold uppercase tracking-wide"
            :class="theme.muted"
          >
            字体
          </p>
          <div class="mb-4 grid grid-cols-2 gap-2">
            <button
              v-for="key in FONT_KEYS"
              :key="key"
              class="rounded-lg border px-2 py-1.5 text-sm transition-colors"
              :class="
                prefs.font === key
                  ? 'border-violet-500 ' + theme.active
                  : theme.border + ' ' + theme.hover
              "
              :style="{ fontFamily: FONTS[key].family }"
              @click="setFont(key)"
            >
              {{ FONTS[key].label }}
            </button>
          </div>

          <p
            class="mb-2 text-xs font-semibold uppercase tracking-wide"
            :class="theme.muted"
          >
            布局
          </p>
          <div class="mb-4 flex gap-2">
            <button
              v-for="item in LAYOUTS"
              :key="item.key"
              class="flex-1 rounded-lg border px-2 py-1.5 text-sm transition-colors"
              :class="
                prefs.layout === item.key
                  ? 'border-violet-500 ' + theme.active
                  : theme.border + ' ' + theme.hover
              "
              @click="setLayout(item.key)"
            >
              {{ item.label }}
            </button>
          </div>

          <p
            class="mb-2 text-xs font-semibold uppercase tracking-wide"
            :class="theme.muted"
          >
            字号
          </p>
          <div class="mb-4 flex items-center gap-2">
            <button
              class="flex-1 rounded-lg border py-1.5 text-lg transition-colors"
              :class="[theme.border, theme.hover]"
              @click="changeFont(-10)"
            >
              A−
            </button>
            <span class="w-14 text-center text-sm tabular-nums"
              >{{ prefs.fontSize }}%</span
            >
            <button
              class="flex-1 rounded-lg border py-1.5 text-lg transition-colors"
              :class="[theme.border, theme.hover]"
              @click="changeFont(10)"
            >
              A+
            </button>
          </div>

          <p
            class="mb-2 text-xs font-semibold uppercase tracking-wide"
            :class="theme.muted"
          >
            行距
          </p>
          <div class="flex items-center gap-2">
            <button
              class="flex-1 rounded-lg border py-1.5 text-lg transition-colors"
              :class="[theme.border, theme.hover]"
              @click="changeLineHeight(-0.1)"
            >
              −
            </button>
            <span class="w-14 text-center text-sm tabular-nums">{{
              prefs.lineHeight.toFixed(1)
            }}</span>
            <button
              class="flex-1 rounded-lg border py-1.5 text-lg transition-colors"
              :class="[theme.border, theme.hover]"
              @click="changeLineHeight(0.1)"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <button
        class="rounded-lg px-2 py-2 text-xs"
        :class="theme.hover"
        @click="toggleSearch"
      >
        搜索
      </button>
      <button
        class="rounded-lg px-2 py-2 text-xs"
        :class="theme.hover"
        @click="toggleBookmarks"
      >
        书签
      </button>
      <button
        class="rounded-lg p-2 transition-colors"
        :class="theme.hover"
        title="关闭书籍"
        @click="emit('close')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-5 w-5"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </header>

    <div
      v-if="sync.error"
      role="status"
      class="flex items-center gap-2 bg-red-50 px-3 py-2 text-xs text-red-700"
    >
      <span class="flex-1">{{ sync.error }}</span
      ><button :disabled="sync.running" class="underline" @click="emit('sync')">
        重试
      </button>
    </div>
    <section
      v-if="bookmarkOpen || searchOpen"
      class="absolute right-3 top-14 z-40 max-h-[70dvh] w-[calc(100%-1.5rem)] max-w-sm overflow-auto rounded-xl border p-4 shadow-xl"
      :class="[theme.surface, theme.border]"
    >
      <template v-if="bookmarkOpen"
        ><div class="flex items-center justify-between">
          <h2 class="font-semibold">书签</h2>
          <button class="rounded border px-2 py-1 text-xs" @click="addBookmark">
            添加当前位置
          </button>
        </div>
        <p v-if="!bookmarks.length" class="mt-3 text-sm">暂无书签</p>
        <div
          v-for="entry in bookmarks"
          :key="entry.cfi"
          class="mt-2 flex gap-2"
        >
          <button
            class="min-w-0 flex-1 truncate text-left text-sm"
            @click="goTo(entry.cfi)"
          >
            {{ entry.label }} · {{ entry.percentage }}%</button
          ><button
            class="text-xs"
            :aria-label="'删除书签 ' + entry.label"
            @click="removeBookmark(entry.cfi)"
          >
            删除
          </button>
        </div></template
      >
      <template v-else
        ><form class="flex gap-2" @submit.prevent="searchBook">
          <input
            v-model="searchQuery"
            aria-label="搜索书内文字"
            placeholder="搜索书内文字"
            class="min-w-0 flex-1 rounded border p-2 text-sm"
            :class="theme.surface"
          /><button :disabled="searching" class="rounded border p-2 text-sm">
            {{ searching ? '搜索中…' : '搜索' }}
          </button>
        </form>
        <p class="mt-2 text-xs">最多显示 100 条结果</p>
        <button
          v-for="result in searchResults"
          :key="result.cfi"
          class="mt-2 block w-full border-b p-2 text-left text-sm"
          :class="theme.border"
          @click="goTo(result.cfi)"
        >
          {{ result.excerpt }}
        </button>
        <p
          v-if="!searching && searchQuery && !searchResults.length"
          class="mt-2 text-sm"
        >
          暂无结果
        </p></template
      >
      <button
        class="mt-3 text-xs underline"
        @click="closePanels"
      >
        关闭
      </button>
    </section>
    <!-- Body -->
    <div class="relative flex min-h-0 flex-1">
      <button
        v-if="mobile && tocOpen"
        class="absolute inset-0 z-30 bg-black/30"
        aria-label="关闭目录"
        @click="tocOpen = false"
      ></button>
      <!-- TOC sidebar -->
      <aside
        v-show="tocOpen"
        ref="tocEl"
        class="toc-scroll w-64 shrink-0 overflow-y-auto border-r"
        :style="
          mobile
            ? {
                position: 'absolute',
                inset: '0 auto 0 0',
                zIndex: 35,
                maxWidth: '85%'
              }
            : {}
        "
        :class="[theme.border, theme.surface]"
      >
        <p
          class="px-4 py-3 text-xs font-semibold uppercase tracking-wide"
          :class="theme.muted"
        >
          目录
        </p>
        <nav class="pb-6">
          <button
            v-for="(item, i) in toc"
            :key="i"
            :ref="(el) => (tocItemEls[i] = el)"
            class="block w-full truncate px-4 py-2 text-left text-sm transition-colors"
            :class="[theme.hover, activeIndex === i ? theme.active : '']"
            :style="{ paddingLeft: 16 + item.depth * 14 + 'px' }"
            :title="item.label"
            @click="goTo(item.href)"
          >
            {{ item.label || '—' }}
          </button>
          <p v-if="!toc.length" class="px-4 py-2 text-sm" :class="theme.muted">
            无目录信息
          </p>
        </nav>
      </aside>

      <!-- Reading area -->
      <main class="relative min-w-0 flex-1">
        <div ref="viewer" class="absolute inset-0"></div>

        <!-- click zones for prev/next -->
        <button
          class="absolute inset-y-0 left-0 z-10 w-[12%] cursor-w-resize bg-transparent"
          title="上一页"
          @touchstart="onTouchStart"
          @touchend="onTouchEnd"
          @click="prev"
        ></button>
        <button
          class="absolute inset-y-0 right-0 z-10 w-[12%] cursor-e-resize bg-transparent"
          title="下一页"
          @touchstart="onTouchStart"
          @touchend="onTouchEnd"
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
            <button
              class="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm text-white"
              @click="emit('close')"
            >
              返回
            </button>
          </div>
          <div v-else class="flex items-center gap-3" :class="theme.muted">
            <svg class="h-6 w-6 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z"
              />
            </svg>
            <span>正在解析电子书…</span>
          </div>
        </div>
      </main>
    </div>

    <div
      v-show="toolbarVisible"
      role="status"
      class="flex justify-between gap-2 border-t px-4 py-1 text-[11px]"
      :class="[theme.surface, theme.border, theme.muted]"
    >
      <span>{{ savedState }}</span
      ><span v-if="sync.running || sync.message">{{ sync.message }}</span>
    </div>
    <!-- Footer / progress -->
    <footer
      v-show="toolbarVisible"
      class="reader-footer flex items-center gap-3 border-t px-4 py-2 text-xs"
      :class="[theme.border, theme.surface, theme.muted]"
    >
      <button
        class="rounded p-1 transition-colors"
        :class="theme.hover"
        title="上一页"
        @click="prev"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-4 w-4"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <input
        type="range"
        min="0"
        max="100"
        :value="progress"
        :disabled="!locationsReady"
        aria-label="跳转阅读进度"
        class="min-w-0 flex-1 accent-violet-600"
        @change="
          goTo(
            book.locations.cfiFromPercentage(Number($event.target.value) / 100)
          )
        "
      />
      <button
        v-if="jumpBack"
        class="shrink-0 underline"
        @click="returnToPosition"
      >
        返回
      </button>
      <button
        class="rounded p-1 transition-colors"
        :class="theme.hover"
        title="下一页"
        @click="next"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-4 w-4"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      <span class="w-10 text-right tabular-nums">{{
        locationsReady ? progress + '%' : '…'
      }}</span>
    </footer>
  </div>
</template>
