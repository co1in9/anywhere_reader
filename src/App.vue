<script setup>
import { ref } from 'vue'
import UploadView from './components/UploadView.vue'
import ReaderView from './components/ReaderView.vue'

const file = ref(null)

function onFile(f) {
  file.value = f
}

function onClose() {
  file.value = null
}
</script>

<template>
  <div class="h-full w-full bg-zinc-50">
    <ReaderView v-if="file" :file="file" @close="onClose" />
    <UploadView v-else @file="onFile" />
  </div>
</template>
