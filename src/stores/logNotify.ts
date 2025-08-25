import { defineStore } from 'pinia'
import { ref } from 'vue'

export type TopNotify = {
  id: string
  message: string
  durationMs?: number
}

export const useLogNotifyStore = defineStore('logNotify', () => {
  const queue = ref<TopNotify[]>([])
  const current = ref<TopNotify | null>(null)
  const progress = ref(0) // 0..100
  let timer: ReturnType<typeof setInterval> | null = null
  let startedAt = 0
  let dur = 5000

  function clearTimer() {
    if (timer) { clearInterval(timer); timer = null }
  }

  function startNext() {
    if (current.value || !queue.value.length) return
    current.value = queue.value.shift() || null
    if (!current.value) return
    progress.value = 0
    startedAt = Date.now()
    dur = Math.max(500, Number(current.value.durationMs || 5000))
    clearTimer()
    timer = setInterval(() => {
      const elapsed = Date.now() - startedAt
      const pct = Math.min(100, Math.round((elapsed / dur) * 100))
      progress.value = pct
      if (elapsed >= dur) {
        dismiss()
      }
    }, 50)
  }

  function enqueue(msg: Omit<TopNotify, 'id'> & { id?: string }) {
    const id = msg.id || crypto.randomUUID()
    queue.value.push({ id, message: msg.message, durationMs: msg.durationMs })
    // If nothing visible, start immediately; otherwise it will show after current
    startNext()
  }

  function dismiss() {
    clearTimer()
    current.value = null
    progress.value = 0
    // Slight delay to allow leave transitions if any, then start next
    setTimeout(() => startNext(), 10)
  }

  function reset() {
    clearTimer()
    queue.value = []
    current.value = null
    progress.value = 0
  }

  return { queue, current, progress, enqueue, dismiss, reset }
})
