<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  books: { type: Array, default: () => [] },
  progress: { type: Object, default: () => ({}) },
  webdavConfigured: { type: Boolean, default: false },
  sync: { type: Object, default: () => ({ running: false, message: '', error: '' }) },
})
const emit = defineEmits(['file', 'open', 'delete', 'sync', 'settings'])

const dragging = ref(false)
const error = ref('')
const fileInput = ref(null)

const hasBooks = computed(() => props.books.length > 0)

function isEpub(file) {
  return (
    file &&
    (file.type === 'application/epub+zip' ||
      file.name.toLowerCase().endsWith('.epub'))
  )
}

function handleFiles(files) {
  error.value = ''
  for (const file of files) {
    if (!isEpub(file)) {
      error.value = '请选择有效的 .epub 文件'
      continue
    }
    emit('file', file)
  }
}

function onDrop(e) {
  dragging.value = false
  handleFiles(e.dataTransfer.files)
}

function onChange(e) {
  handleFiles(e.target.files)
  e.target.value = ''
}

function pct(id) {
  return Math.round(props.progress[id]?.percentage || 0)
}
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
    <header class="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur">
      <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      </div>
      <h1 class="flex-1 text-lg font-bold tracking-tight">Anywhere Reader</h1>

      <span v-if="sync.message" class="hidden text-sm text-zinc-500 sm:inline">{{ sync.message }}</span>
      <span v-if="sync.error" class="hidden text-sm text-red-500 sm:inline">{{ sync.error }}</span>

      <button
        class="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50"
        :disabled="!webdavConfigured || sync.running"
        :title="webdavConfigured ? '与 WebDAV 同步' : '请先配置 WebDAV'"
        @click="emit('sync')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" :class="sync.running ? 'animate-spin' : ''">
          <path d="M21 12a9 9 0 0 1-9 9c-2.5 0-4.8-1-6.4-2.7M3 12a9 9 0 0 1 9-9c2.5 0 4.8 1 6.4 2.7" /><polyline points="21 3 21 9 15 9" /><polyline points="3 21 3 15 9 15" />
        </svg>
        同步
      </button>

      <button
        class="rounded-lg border border-zinc-200 p-2 transition-colors hover:bg-zinc-100"
        title="WebDAV 设置"
        @click="emit('settings')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
          <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </header>

    <!-- Empty state -->
    <div v-if="!hasBooks" class="flex flex-col items-center justify-center px-6 py-24">
      <button
        type="button"
        class="group w-full max-w-xl cursor-pointer rounded-2xl border-2 border-dashed bg-white px-8 py-16 text-center transition-colors"
        :class="dragging ? 'border-violet-500 bg-violet-50' : 'border-zinc-300 hover:border-violet-400'"
        @click="fileInput.click()"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto h-12 w-12 text-zinc-400 transition-colors group-hover:text-violet-500">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p class="mt-4 text-lg font-medium text-zinc-700">点击选择，或将 EPUB 文件拖拽到此处</p>
        <p class="mt-1 text-sm text-zinc-400">书籍保存在浏览器中；配置 WebDAV 后可跨设备同步</p>
      </button>
      <p v-if="error" class="mt-4 text-sm font-medium text-red-500">{{ error }}</p>
    </div>

    <!-- Book grid -->
    <div v-else class="mx-auto max-w-6xl px-4 py-6">
      <p v-if="error" class="mb-4 text-sm font-medium text-red-500">{{ error }}</p>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <!-- Add tile -->
        <button
          type="button"
          class="flex aspect-[3/4] flex-col items-center justify-center rounded-xl border-2 border-dashed text-zinc-400 transition-colors"
          :class="dragging ? 'border-violet-500 bg-violet-50 text-violet-500' : 'border-zinc-300 hover:border-violet-400 hover:text-violet-500'"
          @click="fileInput.click()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-9 w-9"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          <span class="mt-2 text-sm">添加书籍</span>
        </button>

        <!-- Book cards -->
        <div
          v-for="book in books"
          :key="book.id"
          class="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md"
          @click="emit('open', book.id)"
        >
          <div class="flex aspect-[3/4] items-center justify-center bg-gradient-to-br from-violet-500 to-indigo-600 p-3 text-center">
            <span class="line-clamp-5 text-sm font-semibold text-white">{{ book.title }}</span>
          </div>
          <div class="p-2">
            <p class="truncate text-sm font-medium" :title="book.title">{{ book.title }}</p>
            <p class="truncate text-xs text-zinc-400">{{ book.author || '未知作者' }}</p>
            <div class="mt-1.5 flex items-center gap-2">
              <div class="h-1 flex-1 overflow-hidden rounded-full bg-zinc-200">
                <div class="h-full rounded-full bg-violet-500" :style="{ width: pct(book.id) + '%' }"></div>
              </div>
              <span class="text-[11px] tabular-nums text-zinc-400">{{ pct(book.id) }}%</span>
            </div>
          </div>
          <button
            class="absolute right-1.5 top-1.5 rounded-full bg-black/40 p-1 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
            title="删除"
            @click.stop="emit('delete', book.id)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      </div>
    </div>

    <input ref="fileInput" type="file" accept=".epub,application/epub+zip" multiple class="hidden" @change="onChange" />
  </div>
</template>
