<script setup>
import { ref } from 'vue'

const emit = defineEmits(['file'])

const dragging = ref(false)
const error = ref('')
const fileInput = ref(null)

function isEpub(file) {
  return (
    file &&
    (file.type === 'application/epub+zip' ||
      file.name.toLowerCase().endsWith('.epub'))
  )
}

function handleFiles(files) {
  error.value = ''
  const file = files && files[0]
  if (!file) return
  if (!isEpub(file)) {
    error.value = '请选择有效的 .epub 文件'
    return
  }
  emit('file', file)
}

function onDrop(e) {
  dragging.value = false
  handleFiles(e.dataTransfer.files)
}

function onChange(e) {
  handleFiles(e.target.files)
}

function openPicker() {
  fileInput.value?.click()
}
</script>

<template>
  <div class="min-h-full flex flex-col items-center justify-center px-6 py-16">
    <div class="text-center mb-10">
      <div
        class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-600/30"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-8 w-8"
        >
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      </div>
      <h1 class="text-3xl font-bold tracking-tight text-zinc-800">
        Anywhere Reader
      </h1>
      <p class="mt-2 text-zinc-500">纯前端 EPUB 阅读器 · 你的文件不会上传到任何服务器</p>
    </div>

    <button
      type="button"
      class="group w-full max-w-xl cursor-pointer rounded-2xl border-2 border-dashed bg-white px-8 py-14 text-center transition-colors"
      :class="
        dragging
          ? 'border-violet-500 bg-violet-50'
          : 'border-zinc-300 hover:border-violet-400'
      "
      @click="openPicker"
      @dragover.prevent="dragging = true"
      @dragenter.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="mx-auto h-12 w-12 text-zinc-400 transition-colors group-hover:text-violet-500"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <p class="mt-4 text-lg font-medium text-zinc-700">
        点击选择，或将 EPUB 文件拖拽到此处
      </p>
      <p class="mt-1 text-sm text-zinc-400">支持 .epub 格式</p>
    </button>

    <p v-if="error" class="mt-4 text-sm font-medium text-red-500">{{ error }}</p>

    <input
      ref="fileInput"
      type="file"
      accept=".epub,application/epub+zip"
      class="hidden"
      @change="onChange"
    />
  </div>
</template>
