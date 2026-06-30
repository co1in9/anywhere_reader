<script setup>
import { reactive, ref } from 'vue'
import { testConnection } from '../reader/webdav.js'

const props = defineProps({
  config: { type: Object, required: true },
})
const emit = defineEmits(['save', 'close'])

const form = reactive({ ...props.config })
const testing = ref(false)
const testResult = ref(null) // { ok, message }

async function runTest() {
  testing.value = true
  testResult.value = null
  testResult.value = await testConnection({ ...form })
  testing.value = false
}

function save() {
  emit('save', { ...form })
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-bold text-zinc-800">WebDAV 同步设置</h2>
        <button class="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100" @click="emit('close')">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      <div class="space-y-3">
        <label class="block">
          <span class="text-sm font-medium text-zinc-600">服务器地址</span>
          <input
            v-model.trim="form.url"
            type="url"
            placeholder="https://dav.example.com/remote.php/dav/files/user"
            class="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-sm font-medium text-zinc-600">用户名</span>
            <input
              v-model.trim="form.username"
              type="text"
              autocomplete="username"
              class="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium text-zinc-600">密码</span>
            <input
              v-model="form.password"
              type="password"
              autocomplete="current-password"
              class="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </label>
        </div>

        <label class="block">
          <span class="text-sm font-medium text-zinc-600">同步目录</span>
          <input
            v-model.trim="form.baseDir"
            type="text"
            placeholder="/anywhere-reader"
            class="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          <span class="mt-1 block text-xs text-zinc-400">
            书籍存于 <code>{{ form.baseDir || '/anywhere-reader' }}/books</code>，进度存于 <code>progress.json</code>
          </span>
        </label>

        <label class="flex items-center gap-2">
          <input v-model="form.autoSync" type="checkbox" class="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500" />
          <span class="text-sm text-zinc-600">自动同步（打开应用时及阅读时）</span>
        </label>
      </div>

      <div
        v-if="testResult"
        class="mt-4 rounded-lg px-3 py-2 text-sm"
        :class="testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'"
      >
        {{ testResult.message }}
      </div>

      <div class="mt-5 flex items-center justify-between gap-3">
        <button
          class="flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50"
          :disabled="testing || !form.url"
          @click="runTest"
        >
          <svg v-if="testing" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
          </svg>
          测试连接
        </button>
        <div class="flex gap-2">
          <button class="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100" @click="emit('close')">取消</button>
          <button class="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
