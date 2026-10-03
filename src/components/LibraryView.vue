<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { notify, errorText } from '../reader/feedback.js'
import { canInstall, promptInstall } from '../reader/pwa.js'
import logoUrl from '../assets/logo.png'

const props = defineProps({
  books: { type: Array, default: () => [] },
  progress: { type: Object, default: () => ({}) },
  webdavConfigured: { type: Boolean, default: false },
  sync: {
    type: Object,
    default: () => ({ running: false, message: '', error: '' })
  },
  transfer: {
    type: Object,
    default: () => ({ running: false, message: '', failed: [] })
  }
})
const emit = defineEmits([
  'file',
  'open',
  'delete',
  'sync',
  'settings',
  'backup',
  'restore',
  'retry-import',
  'status',
  'restore-book',
  'purge-book'
])

const dragging = ref(false)
const error = ref('')
const fileInput = ref(null)

const query = ref('')
const sort = ref('recent')
const filter = ref('all')
const backupInput = ref(null)
const storageInfo = ref('')
const persistent = ref(false)
const activeBooks = computed(() =>
  props.books.filter((b) => !b.removedAt && !b.purged)
)
const hasBooks = computed(() => activeBooks.value.length > 0)
function stateOf(book) {
  const p = props.progress[book.id]
  return (
    p?.status ||
    ((p?.percentage || 0) >= 99 ? 'finished' : p?.cfi ? 'reading' : 'unread')
  )
}
const displayedBooks = computed(() => {
  const q = query.value.trim().toLocaleLowerCase()
  return props.books
    .filter((b) => !b.purged)
    .filter((b) => (filter.value === 'removed' ? b.removedAt : !b.removedAt))
    .filter(
      (b) =>
        !q || `${b.title} ${b.author} ${b.name}`.toLocaleLowerCase().includes(q)
    )
    .filter(
      (b) =>
        ['all', 'removed'].includes(filter.value) || stateOf(b) === filter.value
    )
    .slice()
    .sort((a, b) =>
      sort.value === 'title'
        ? a.title.localeCompare(b.title, 'zh-CN')
        : sort.value === 'added'
          ? b.addedAt - a.addedAt
          : (props.progress[b.id]?.updatedAt || b.addedAt) -
            (props.progress[a.id]?.updatedAt || a.addedAt)
    )
})
const lastBook = computed(
  () =>
    activeBooks.value
      .filter((b) => props.progress[b.id]?.cfi && stateOf(b) !== 'finished')
      .sort(
        (a, b) =>
          props.progress[b.id].updatedAt - props.progress[a.id].updatedAt
      )[0]
)
async function inspectStorage() {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (estimate)
      storageInfo.value = `已用 ${(estimate.usage / 1024 / 1024).toFixed(1)} MB / 约 ${(estimate.quota / 1024 / 1024 / 1024).toFixed(1)} GB`
    persistent.value = (await navigator.storage?.persisted?.()) || false
  } catch (e) {
    notify(errorText(e))
  }
}
async function persistStorage() {
  try {
    persistent.value = (await navigator.storage?.persist?.()) || false
    notify(
      persistent.value
        ? '已启用持久存储，仍建议定期备份。'
        : '浏览器未批准持久存储，请定期导出备份。',
      'info'
    )
  } catch (e) {
    notify(errorText(e))
  }
}
inspectStorage()

function isEpub(file) {
  return (
    file &&
    (file.type === 'application/epub+zip' ||
      file.name.toLowerCase().endsWith('.epub'))
  )
}

function handleFiles(files) {
  error.value = ''
  const valid = []
  for (const file of files) {
    if (!isEpub(file)) {
      error.value = '请选择有效的 .epub 文件'
      continue
    }
    valid.push(file)
  }
  if (valid.length) emit('file', valid)
}

function onDrop(e) {
  dragging.value = false
  handleFiles(e.dataTransfer.files)
}

function onBackupChange(e) {
  if (e.target.files[0]) emit('restore', e.target.files[0])
  e.target.value = ''
}
function onChange(e) {
  handleFiles(e.target.files)
  e.target.value = ''
}

function pct(id) {
  return Math.round(props.progress[id]?.percentage || 0)
}

const coverCache = new Map()

function coverOf(book) {
  if (!book.cover) {
    if (coverCache.has(book.id)) {
      URL.revokeObjectURL(coverCache.get(book.id).url)
      coverCache.delete(book.id)
    }
    return null
  }
  const cached = coverCache.get(book.id)
  if (
    cached &&
    cached.size === book.cover.size &&
    cached.type === book.cover.type
  ) {
    return cached.url
  }
  if (cached) URL.revokeObjectURL(cached.url)
  const url = URL.createObjectURL(book.cover)
  coverCache.set(book.id, { size: book.cover.size, type: book.cover.type, url })
  return url
}

onBeforeUnmount(() => {
  for (const { url } of coverCache.values()) {
    URL.revokeObjectURL(url)
  }
  coverCache.clear()
})
</script>

<template>
  <div
    class="min-h-full bg-zinc-50 text-zinc-800"
    @dragover.prevent="dragging = true"
    @dragenter.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <!-- Top bar -->
    <header
      class="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur"
    >
      <img
        :src="logoUrl"
        alt="Anywhere Reader"
        class="h-9 w-9 object-contain"
      />
      <h1
        class="min-w-0 flex-1 truncate text-base font-bold tracking-tight sm:text-lg"
      >
        Anywhere Reader
      </h1>

      <span
        v-if="sync.message"
        class="hidden text-sm text-zinc-600 lg:inline"
        >{{ sync.message }}</span
      >
      <span v-if="sync.error" class="hidden text-sm text-red-600 lg:inline">{{
        sync.error
      }}</span>

      <button
        v-if="canInstall"
        class="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-700"
        title="安装为应用"
        @click="promptInstall()"
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
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        安装
      </button>

      <button
        class="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50"
        :disabled="!webdavConfigured || sync.running"
        :title="webdavConfigured ? '与 WebDAV 同步' : '请先配置 WebDAV'"
        @click="emit('sync')"
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
          :class="sync.running ? 'animate-spin' : ''"
        >
          <path
            d="M21 12a9 9 0 0 1-9 9c-2.5 0-4.8-1-6.4-2.7M3 12a9 9 0 0 1 9-9c2.5 0 4.8 1 6.4 2.7"
          />
          <polyline points="21 3 21 9 15 9" />
          <polyline points="3 21 3 15 9 15" />
        </svg>
        同步
      </button>

      <button
        class="rounded-lg border border-zinc-200 p-2 transition-colors hover:bg-zinc-100"
        title="WebDAV 设置"
        @click="emit('settings')"
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
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </button>
    </header>

    <div class="mx-auto max-w-6xl px-4 pt-4">
      <div
        v-if="sync.message || sync.error"
        role="status"
        class="mb-3 flex items-center gap-2 rounded-lg bg-white p-3 text-sm"
        :class="sync.error ? 'text-red-700' : 'text-zinc-600'"
      >
        <span class="flex-1">{{ sync.error || sync.message }}</span
        ><button
          v-if="sync.error"
          :disabled="sync.running"
          class="underline"
          @click="emit('sync')"
        >
          重试
        </button>
      </div>
      <div
        v-if="transfer.message"
        role="status"
        class="mb-3 rounded-lg bg-violet-50 p-3 text-sm text-violet-800"
      >
        {{ transfer.message }}
        <ul v-if="transfer.failed.length" class="mt-2 list-inside list-disc">
          <li v-for="failure in transfer.failed" :key="failure.file.name">
            {{ failure.file.name }}：{{ failure.message }}
          </li>
        </ul>
        <button
          v-if="transfer.failed.length"
          :disabled="transfer.running"
          class="mt-2 underline"
          @click="emit('retry-import')"
        >
          重试失败项
        </button>
      </div>
      <button
        v-if="lastBook && filter !== 'removed'"
        class="mb-4 flex w-full items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-left"
        @click="emit('open', lastBook.id)"
      >
        <span class="min-w-0"
          ><span class="block text-xs text-violet-700"
            >继续阅读 · {{ pct(lastBook.id) }}%</span
          ><span class="block truncate font-semibold">{{
            lastBook.title
          }}</span></span
        ><span class="shrink-0 text-sm text-violet-700">继续 →</span>
      </button>
      <div class="flex flex-wrap gap-2">
        <input
          v-model="query"
          type="search"
          aria-label="搜索书籍"
          placeholder="搜索书名或作者"
          class="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
        <select
          v-model="sort"
          aria-label="书架排序"
          class="rounded-lg border border-zinc-300 bg-white px-2 text-sm"
        >
          <option value="recent">最近阅读</option>
          <option value="added">最近添加</option>
          <option value="title">书名</option>
        </select>
        <select
          v-model="filter"
          aria-label="筛选书籍"
          class="rounded-lg border border-zinc-300 bg-white px-2 text-sm"
        >
          <option value="all">全部</option>
          <option value="unread">未读</option>
          <option value="reading">在读</option>
          <option value="finished">已读</option>
          <option value="removed">回收站</option>
        </select>
      </div>
      <details
        class="mt-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm"
        @toggle="inspectStorage"
      >
        <summary class="cursor-pointer font-medium">备份与存储</summary>
        <p class="my-2 text-xs text-zinc-600">
          {{ storageInfo }}{{ persistent ? ' · 已启用持久存储' : '' }}
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            class="rounded border px-3 py-2 disabled:opacity-50"
            :disabled="transfer.running"
            @click="emit('backup')"
          >
            导出备份</button
          ><button
            class="rounded border px-3 py-2 disabled:opacity-50"
            :disabled="transfer.running"
            @click="backupInput.click()"
          >
            恢复备份</button
          ><button
            v-if="!persistent"
            class="rounded border px-3 py-2"
            @click="persistStorage"
          >
            保护本地存储
          </button>
        </div>
        <p class="mt-2 text-xs text-zinc-600">
          备份包含书籍、进度、书签和阅读设置，不包含 WebDAV 密码。
        </p>
        <p class="mt-2 text-xs text-zinc-600">
          iPhone / iPad：Safari 分享菜单 → 添加到主屏幕，即可安装。
        </p>
      </details>
    </div>

    <!-- Empty state -->
    <div
      v-if="!hasBooks && filter !== 'removed'"
      class="flex flex-col items-center justify-center px-6 py-24"
    >
      <button
        type="button"
        class="group w-full max-w-xl cursor-pointer rounded-2xl border-2 border-dashed bg-white px-8 py-16 text-center transition-colors"
        :class="
          dragging
            ? 'border-violet-500 bg-violet-50'
            : 'border-zinc-300 hover:border-violet-400'
        "
        @click="fileInput.click()"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="mx-auto h-12 w-12 text-zinc-500 transition-colors group-hover:text-violet-500"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p class="mt-4 text-lg font-medium text-zinc-700">
          点击选择，或将 EPUB 文件拖拽到此处
        </p>
        <p class="mt-1 text-sm text-zinc-500">
          书籍保存在浏览器中；配置 WebDAV 后可跨设备同步
        </p>
      </button>
      <p v-if="error" class="mt-4 text-sm font-medium text-red-500">
        {{ error }}
      </p>
    </div>

    <!-- Book grid -->
    <div v-else class="mx-auto max-w-6xl px-4 py-6">
      <p v-if="error" class="mb-4 text-sm font-medium text-red-500">
        {{ error }}
      </p>
      <p v-if="!displayedBooks.length" class="mb-4 text-sm text-zinc-600">
        {{ filter === 'removed' ? '回收站为空' : '没有匹配的书籍' }}
      </p>
      <div
        class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
      >
        <!-- Add tile -->
        <button
          type="button"
          class="flex aspect-[3/4] flex-col items-center justify-center rounded-xl border-2 border-dashed text-zinc-500 transition-colors"
          :class="
            dragging
              ? 'border-violet-500 bg-violet-50 text-violet-500'
              : 'border-zinc-300 hover:border-violet-400 hover:text-violet-500'
          "
          @click="fileInput.click()"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-9 w-9"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span class="mt-2 text-sm">添加书籍</span>
        </button>

        <!-- Book cards -->
        <div
          v-for="book in displayedBooks"
          :key="book.id"
          class="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md"
          @click="!book.removedAt && emit('open', book.id)"
          role="button"
          :tabindex="book.removedAt ? -1 : 0"
          :aria-label="'阅读 ' + book.title"
          @keydown.enter.self="!book.removedAt && emit('open', book.id)"
          @keydown.space.prevent.self="!book.removedAt && emit('open', book.id)"
        >
          <div class="relative aspect-[3/4] overflow-hidden bg-zinc-100">
            <img
              v-if="coverOf(book)"
              :src="coverOf(book)"
              class="h-full w-full object-cover"
              :alt="book.title + '封面'"
              loading="lazy"
              decoding="async"
            />
            <div
              v-else
              class="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-500 to-indigo-600 p-3 text-center"
            >
              <span class="line-clamp-5 text-sm font-semibold text-white">{{
                book.title
              }}</span>
            </div>
          </div>
          <button
            v-if="book.removedAt"
            class="absolute right-2 top-2 rounded bg-white px-2 py-1 text-xs"
            @click.stop="emit('restore-book', book.id)"
          >
            恢复
          </button>
          <button
            v-if="book.removedAt"
            class="absolute left-2 top-2 rounded bg-white px-2 py-1 text-xs text-red-700"
            @click.stop="emit('purge-book', book.id)"
          >
            清理文件
          </button>
          <div class="p-2">
            <p class="truncate text-sm font-medium" :title="book.title">
              {{ book.title }}
            </p>
            <p class="truncate text-xs text-zinc-500">
              {{ book.author || '未知作者' }}
            </p>
            <div class="mt-1.5 flex items-center gap-2">
              <div class="h-1 flex-1 overflow-hidden rounded-full bg-zinc-200">
                <div
                  class="h-full rounded-full bg-violet-500"
                  :style="{ width: pct(book.id) + '%' }"
                ></div>
              </div>
              <span class="text-[11px] tabular-nums text-zinc-500"
                >{{ pct(book.id) }}%</span
              >
            </div>
            <select
              v-if="!book.removedAt"
              :value="stateOf(book)"
              :aria-label="book.title + '阅读状态'"
              class="mt-2 w-full rounded border border-zinc-200 bg-white p-1 text-xs"
              @click.stop
              @keydown.stop
              @change="emit('status', book.id, $event.target.value)"
            >
              <option value="unread">未读</option>
              <option value="reading">在读</option>
              <option value="finished">已读</option>
            </select>
          </div>
          <button
            class="absolute right-1.5 top-1.5 rounded-full bg-black/40 p-1 text-white opacity-100 transition-opacity hover:bg-black/70 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
            v-if="!book.removedAt"
            :aria-label="'移除 ' + book.title"
            title="移除到回收站"
            @click.stop="emit('delete', book.id)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-3.5 w-3.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <input
      ref="backupInput"
      type="file"
      accept=".zip"
      class="hidden"
      @change="onBackupChange"
    />
    <input
      ref="fileInput"
      type="file"
      accept=".epub,application/epub+zip"
      multiple
      class="hidden"
      @change="onChange"
    />
  </div>
</template>
