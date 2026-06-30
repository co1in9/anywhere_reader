<script setup>
import { ref, reactive, onMounted } from 'vue'
import LibraryView from './components/LibraryView.vue'
import ReaderView from './components/ReaderView.vue'
import SettingsModal from './components/SettingsModal.vue'
import { hashBlob, putBook, getBook, deleteBook, listBooks } from './reader/db.js'
import { loadAllProgress, loadWebDAVConfig, saveWebDAVConfig } from './reader/storage.js'
import { syncAll, pushProgress } from './reader/sync.js'

const books = ref([])
const progress = ref({})
const currentBook = ref(null)
const showSettings = ref(false)

const webdav = reactive(loadWebDAVConfig())
const sync = reactive({ running: false, message: '', error: '' })

async function refreshLibrary() {
  books.value = await listBooks()
  progress.value = loadAllProgress()
}

function webdavReady() {
  return !!webdav.url
}

onMounted(async () => {
  await refreshLibrary()
  if (webdavReady() && webdav.autoSync) {
    doSync()
  }
})

async function handleUpload(file) {
  const id = await hashBlob(file)
  const existing = await getBook(id)
  if (!existing) {
    await putBook({
      id,
      name: file.name,
      title: file.name.replace(/\.epub$/i, ''),
      author: '',
      size: file.size,
      addedAt: Date.now(),
      blob: file,
    })
    await refreshLibrary()
    if (webdavReady() && webdav.autoSync) doSync()
  }
  openBookById(id)
}

async function openBookById(id) {
  const record = await getBook(id)
  if (record) currentBook.value = record
}

async function onDelete(id) {
  await deleteBook(id)
  await refreshLibrary()
}

function closeBook() {
  currentBook.value = null
  refreshLibrary()
}

// Update stored metadata once the reader has parsed the real title/author.
async function onMeta({ id, title, author }) {
  const record = await getBook(id)
  if (!record) return
  let changed = false
  if (title && record.title !== title) {
    record.title = title
    changed = true
  }
  if (author && record.author !== author) {
    record.author = author
    changed = true
  }
  if (changed) {
    await putBook(record)
    refreshLibrary()
  }
}

let progressTimer = null
function onProgress() {
  if (!webdavReady() || !webdav.autoSync) return
  clearTimeout(progressTimer)
  progressTimer = setTimeout(() => {
    pushProgress({ ...webdav }).catch(() => {})
  }, 4000)
}

async function doSync() {
  if (sync.running || !webdavReady()) return
  sync.running = true
  sync.error = ''
  sync.message = '开始同步…'
  try {
    const res = await syncAll(
      { ...webdav },
      { onStatus: (m) => (sync.message = m) }
    )
    await refreshLibrary()
    sync.message = `同步完成：上传 ${res.pushed}，下载 ${res.pulled}`
  } catch (e) {
    sync.error = '同步失败：' + (e?.message || e)
    sync.message = ''
  } finally {
    sync.running = false
  }
}

function saveSettings(cfg) {
  Object.assign(webdav, cfg)
  saveWebDAVConfig({ ...webdav })
  showSettings.value = false
  if (webdavReady() && webdav.autoSync) doSync()
}
</script>

<template>
  <div class="h-full w-full">
    <ReaderView
      v-if="currentBook"
      :book="currentBook"
      @close="closeBook"
      @meta="onMeta"
      @progress="onProgress"
    />
    <LibraryView
      v-else
      :books="books"
      :progress="progress"
      :webdav-configured="webdavReady()"
      :sync="sync"
      @file="handleUpload"
      @open="openBookById"
      @delete="onDelete"
      @sync="doSync"
      @settings="showSettings = true"
    />

    <SettingsModal
      v-if="showSettings"
      :config="webdav"
      @save="saveSettings"
      @close="showSettings = false"
    />
  </div>
</template>
