<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
defineProps({ title: String, message: String, actions: Array })
const emit = defineEmits(['choose', 'close'])
const dialog = ref(null)
let previousFocus
function onKey(e) {
  if (e.key === 'Escape') emit('close')
  if (e.key !== 'Tab') return
  const buttons = [...dialog.value.querySelectorAll('button')]
  if (e.shiftKey && document.activeElement === buttons[0]) {
    e.preventDefault()
    buttons.at(-1).focus()
  } else if (!e.shiftKey && document.activeElement === buttons.at(-1)) {
    e.preventDefault()
    buttons[0].focus()
  }
}
onMounted(() => {
  previousFocus = document.activeElement
  nextTick(() => dialog.value.querySelector('button').focus())
})
onBeforeUnmount(() => previousFocus?.focus())
</script>
<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="emit('close')"
  >
    <section
      ref="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-description"
      class="w-full max-w-sm rounded-2xl bg-white p-5 text-zinc-800"
      @keydown="onKey"
    >
      <h2 id="confirm-title" class="font-bold">{{ title }}</h2>
      <p id="confirm-description" class="my-3 text-sm text-zinc-600">
        {{ message }}
      </p>
      <div class="flex flex-col gap-2">
        <button class="rounded-lg border p-2 text-sm" @click="emit('close')">
          取消</button
        ><button
          v-for="action in actions"
          :key="action.value"
          class="rounded-lg border p-2 text-sm"
          :class="action.danger ? 'text-red-700' : ''"
          @click="emit('choose', action.value)"
        >
          {{ action.label }}
        </button>
      </div>
    </section>
  </div>
</template>
