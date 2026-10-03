<script setup>
import {
  ref,
  reactive,
  onMounted,
  onBeforeUnmount,
  defineAsyncComponent
} from 'vue'
import LibraryView from './components/LibraryView.vue'
const ReaderView = defineAsyncComponent(
  () => import('./components/ReaderView.vue')
)
import SettingsModal from './components/SettingsModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import {
  putBook,
  getBook,
  removeBook,
  restoreBook,
  listBooks,
  updateBookMeta,
  purgeBookFiles
} from './reader/db.js'
import { notify, notice, errorText } from './reader/feedback.js'
import { setReadingStatus } from './reader/storage.js'
import {
  loadAllProgress,
  loadWebDAVConfig,
  saveWebDAVConfig
} from './reader/storage.js'
import { syncAll, pushProgress } from './reader/sync.js'
import { onLaunchFiles, updateReady, applyUpdate } from './reader/pwa.js'

const books = ref([])
const progress = ref({})
const currentBook = ref(null)
const showSettings = ref(false)
const removing = ref(null)
const purging = ref(null)
const lastRemoved = ref(null)
const transfer = reactive({ running: false, message: '', failed: [] })
let importQueue = Promise.resolve()
let coverQueue = Promise.resolve()
function report(e) {
  notify(errorText(e))
}
async function safely(fn) {
  try {
    return await fn()
  } catch (e) {
    report(e)
  }
}

const webdav = reactive(loadWebDAVConfig())
const sync = reactive({ running: false, message: '', error: '' })

async function refreshLibrary() {
  books.value = await listBooks({ includeRemoved: true })
  progress.value = loadAllProgress()
}

async function extractAndStoreCover(id) {
  const record = await getBook(id)
  if (
    !record ||
    record.removedAt ||
    record.coverFailed ||
    (record.cover && record.thumbnailVersion === 1)
  )
    return record
  const { extractCover, thumbnailCover } = await import('./reader/cover.js')
  const original = record.cover || (await extractCover(record.blob))
  const cover = original ? await thumbnailCover(original) : null
  if (cover) {
    record.cover = cover
    record.coverMime = cover.type
    record.coverFailed = false
  } else {
    record.cover = undefined
    record.coverMime = ''
    record.coverFailed = true
  }
  record.thumbnailVersion = 1
  // Preserve any metadata changes made while extraction was running.
  const current = await getBook(id)
  if (current && !current.removedAt)
    await putBook({
      ...current,
      cover: record.cover,
      coverMime: record.coverMime,
      coverFailed: record.coverFailed,
      thumbnailVersion: 1,
      metadataUpdatedAt: Date.now()
    })
  return record
}

async function loadMissingCovers() {
  const metas = await listBooks()
  let changed = false
  for (const meta of metas) {
    if ((meta.cover && meta.thumbnailVersion === 1) || meta.coverFailed)
      continue
    await queueCover(meta.id)
    changed = true
  }
  if (changed) await refreshLibrary()
}

function queueCover(id) {
  const job = coverQueue.then(() => extractAndStoreCover(id))
  coverQueue = job.catch(report)
  return job
}
function webdavReady() {
  return !!webdav.url
}

onMounted(async () => {
  onLaunchFiles(handleUpload)
  await safely(refreshLibrary)
  loadMissingCovers().catch(report)
  if (webdavReady() && webdav.autoSync) {
    doSync()
  }
})

function handleUpload(files) {
  const batch = Array.isArray(files) ? files : [files]
  importQueue = importQueue.then(() => importFiles(batch)).catch(report)
  return importQueue
}
async function importFiles(files) {
  transfer.running = true
  transfer.failed = []
  let openedId
  try {
    const { importBook } = await import('./reader/import.js')
    for (const [index, file] of files.entries()) {
      transfer.message = `导入 ${index + 1}/${files.length}：${file.name}`
      try {
        const id = await importBook(file)
        openedId = id
        queueCover(id).then(refreshLibrary).catch(report)
      } catch (e) {
        transfer.failed.push({ file, message: errorText(e) })
      }
    }
    await refreshLibrary()
    transfer.message = `导入完成：成功 ${files.length - transfer.failed.length}，失败 ${transfer.failed.length}`
    if (files.length === 1 && openedId) await openBookById(openedId)
    if (webdavReady() && webdav.autoSync) doSync()
  } finally {
    transfer.running = false
  }
}
async function openBookById(id) {
  await safely(async () => {
    const record = await getBook(id)
    if (record && !record.removedAt) currentBook.value = record
  })
}
async function onDelete(mode) {
  await safely(async () => {
    await removeBook(removing.value.id, mode)
    lastRemoved.value = removing.value
    removing.value = null
    await refreshLibrary()
    if (mode === 'sync' && webdavReady()) doSync()
  })
}
async function undoRemove() {
  await safely(async () => {
    await restoreBook(lastRemoved.value.id)
    lastRemoved.value = null
    await refreshLibrary()
    if (webdavReady() && webdav.autoSync) doSync()
  })
}
async function restoreRemoved(id) {
  await safely(async () => {
    await restoreBook(id)
    if (lastRemoved.value?.id === id) lastRemoved.value = null
    await refreshLibrary()
    if (webdavReady() && webdav.autoSync) doSync()
  })
}
async function purgeRemoved() {
  await safely(async () => {
    await purgeBookFiles(purging.value.id)
    if (lastRemoved.value?.id === purging.value.id) lastRemoved.value = null
    purging.value = null
    await refreshLibrary()
  })
}
async function changeStatus(id, status) {
  if (setReadingStatus(id, status)) {
    await refreshLibrary()
    onProgress()
  }
}
async function backup() {
  if (transfer.running) return
  transfer.running = true
  try {
    const { exportBackup, downloadBlob } = await import('./reader/backup.js')
    const blob = await exportBackup((m) => (transfer.message = m))
    downloadBlob(
      blob,
      `anywhere-reader-${new Date().toISOString().slice(0, 10)}.zip`
    )
    transfer.message = '备份已导出（不包含 WebDAV 密码）'
  } catch (e) {
    report(e)
  } finally {
    transfer.running = false
  }
}
async function restoreBackup(file) {
  if (transfer.running) return
  transfer.running = true
  try {
    const { importBackup } = await import('./reader/backup.js')
    const count = await importBackup(file, (m) => (transfer.message = m))
    await refreshLibrary()
    loadMissingCovers().catch(report)
    transfer.message = `备份恢复完成：${count} 本书`
  } catch (e) {
    report(e)
  } finally {
    transfer.running = false
  }
}

function closeBook() {
  flushProgress()
  currentBook.value = null
  safely(refreshLibrary)
}

// Update stored metadata once the reader has parsed the real title/author.
async function onMeta({ id, title, author }) {
  await safely(async () => {
    await updateBookMeta(id, (previous) => ({
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
      metadataUpdatedAt:
        (title && title !== previous.title) ||
        (author && author !== previous.author)
          ? Date.now()
          : previous.metadataUpdatedAt
    }))
    await refreshLibrary()
  })
}

let progressTimer = null
function onProgress() {
  if (!webdavReady() || !webdav.autoSync) return
  clearTimeout(progressTimer)
  progressTimer = setTimeout(() => {
    flushProgress()
  }, 4000)
}

async function flushProgress() {
  clearTimeout(progressTimer)
  if (!webdavReady() || !webdav.autoSync || sync.running) return
  sync.running = true
  sync.error = ''
  sync.message = '保存云端进度…'
  try {
    await pushProgress({ ...webdav })
    sync.message = '进度已同步'
  } catch (e) {
    sync.error = '进度同步失败：' + errorText(e)
    sync.message = ''
    notify(sync.error)
  } finally {
    sync.running = false
  }
}
function onStorage() {
  safely(refreshLibrary)
}
function onVisibility() {
  if (document.visibilityState === 'hidden') flushProgress()
}
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', doSync)
  window.addEventListener('storage', onStorage)
})
onBeforeUnmount(() => {
  clearTimeout(progressTimer)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('online', doSync)
  window.removeEventListener('storage', onStorage)
})
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
    loadMissingCovers().catch(report)
    sync.message = `同步完成：上传 ${res.pushed}，下载 ${res.pulled}`
  } catch (e) {
    sync.error = '同步失败：' + errorText(e)
    notify(sync.error)
    sync.message = ''
  } finally {
    sync.running = false
  }
}

async function updateApp() {
  await flushProgress()
  await applyUpdate()
}
function saveSettings(cfg) {
  if (!saveWebDAVConfig(cfg)) return
  Object.assign(webdav, cfg)
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
      :sync="sync"
      @sync="doSync"
    />
    <LibraryView
      v-else
      :books="books"
      :progress="progress"
      :webdav-configured="webdavReady()"
      :sync="sync"
      :transfer="transfer"
      @backup="backup"
      @restore="restoreBackup"
      @status="changeStatus"
      @restore-book="restoreRemoved"
      @purge-book="(id) => (purging = books.find((b) => b.id === id))"
      @retry-import="handleUpload(transfer.failed.map((f) => f.file))"
      @file="handleUpload"
      @open="openBookById"
      @delete="(id) => (removing = books.find((b) => b.id === id))"
      @sync="doSync"
      @settings="showSettings = true"
    />

    <SettingsModal
      v-if="showSettings"
      :config="webdav"
      @save="saveSettings"
      @close="showSettings = false"
    />

    <ConfirmDialog
      v-if="removing"
      :title="'移除《' + removing.title + '》'"
      message="书籍会保留在回收站，可随时恢复。"
      :actions="[
        { value: 'local', label: '仅从此设备移除' },
        ...(webdavReady()
          ? [{ value: 'sync', label: '同步移除（所有设备）', danger: true }]
          : [])
      ]"
      @choose="onDelete"
      @close="removing = null"
    />
    <ConfirmDialog
      v-if="purging"
      :title="'永久清理《' + purging.title + '》'"
      message="将删除此设备上的书籍文件以释放空间，无法从回收站撤销。请先导出备份；清理后可重新导入 EPUB。云端文件不受影响。"
      :actions="[{ value: 'purge', label: '永久清理本地文件', danger: true }]"
      @choose="purgeRemoved"
      @close="purging = null"
    />
    <div
      v-if="notice || lastRemoved"
      role="status"
      class="fixed bottom-12 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-xl bg-zinc-900 p-3 text-sm text-white shadow-xl"
    >
      <div v-if="notice" class="flex items-center gap-3">
        <span class="flex-1">{{ notice.message }}</span
        ><button class="shrink-0 underline" @click="notice = null">关闭</button>
      </div>
      <div v-else class="flex items-center gap-3">
        <span class="flex-1">已移除《{{ lastRemoved.title }}》</span
        ><button class="underline" @click="undoRemove">撤销</button
        ><button aria-label="关闭提示" @click="lastRemoved = null">✕</button>
      </div>
    </div>

    <div
      v-if="updateReady"
      class="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg"
    >
      <span>有新版本可用</span>
      <button
        class="rounded-full bg-violet-500 px-3 py-1 font-medium"
        @click="updateApp"
      >
        刷新
      </button>
      <button class="text-zinc-400" title="稍后" @click="updateReady = false">
        ✕
      </button>
    </div>
  </div>
</template>
