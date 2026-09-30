import { defineStore } from 'pinia'
import { ref } from 'vue'

export type TopNotify = {
  id: string
  message: string
  durationMs?: number
}

// Activity from other editors, shown one at a time
export const useLogNotifyStore = defineStore('logNotify', () => {
  const queue = ref<TopNotify[]>([])
  const current = ref<TopNotify | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  function startNext() {
    if (current.value || !queue.value.length) return
    current.value = queue.value.shift() || null
    if (current.value) timer = setTimeout(dismiss, Math.max(500, Number(current.value.durationMs || 5000)))
  }

  function enqueue(msg: Omit<TopNotify, 'id'> & { id?: string }) {
    const id = msg.id || crypto.randomUUID()
    queue.value.push({ id, message: msg.message, durationMs: msg.durationMs })
    startNext()
  }

  function dismiss() {
    clearTimeout(timer)
    current.value = null
    startNext()
  }

  return { current, enqueue, dismiss }
})
