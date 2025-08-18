import { defineStore } from 'pinia'

const KEY = 'lik:lastBackupSuggestTS'
const DAY = 24 * 60 * 60 * 1000

function getLast(): number | 'already_written' | null {
  try {
    const v = localStorage.getItem(KEY)
    if (!v) return null
    if (v === 'already_written') return 'already_written'
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function setLast(ts: number | 'already_written') {
  try { localStorage.setItem(KEY, ts === 'already_written' ? ts : String(ts)) } catch {}
}

export const useBackupReminderStore = defineStore('backupReminder', {
  state: () => ({ open: false, reveal: false as boolean }),
  actions: {
    openDrawer() { this.open = true },
    closeDrawer() { this.open = false; this.reveal = false },
    markWritten() { setLast('already_written'); this.closeDrawer() },
    remindLater() { setLast(Date.now()); this.closeDrawer() },
    showSecret() { this.reveal = true },
    shouldPrompt(boardCreatedAt: number | null | undefined): boolean {
      // must have a board older than 3 days
      const created = Number(boardCreatedAt || 0)
      if (!Number.isFinite(created)) return false
      if (Date.now() - created < 3 * DAY) return false
      const last = getLast()
      if (last === 'already_written') return false
      if (typeof last === 'number' && Date.now() - last < 5 * DAY) return false
      return true
    },
    promptIfNeeded(boardCreatedAt: number | null | undefined) {
      if (this.open) return
      if (this.shouldPrompt(boardCreatedAt)) this.openDrawer()
    },
  },
})
