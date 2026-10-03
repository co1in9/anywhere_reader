import { ref } from 'vue'

export const notice = ref(null)
export function notify(message, kind = 'error') {
  notice.value = { message, kind }
}
export function errorText(error) {
  if (error?.name === 'QuotaExceededError')
    return '存储空间不足，请备份并清理部分书籍后重试。'
  return error?.message || String(error)
}
