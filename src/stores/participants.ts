import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { dbBulkDelete, dbBulkPut, dbDelete, dbGetAll, dbPut } from '@/lib/idb'
import shortId from '@/lib/utils'

export interface Participant {
  id: string // shortId
  boardId: string
  name: string
  createdAt: number
}

export const useParticipantsStore = defineStore('participants', () => {
  const items = ref<Participant[]>([])
  const STORE = 'participants'
  let hydrating = false
  let initPromise: Promise<void> | null = null

  async function loadAll(): Promise<Participant[]> {
    try {
      const rows = await dbGetAll<Participant>(STORE)
      return rows
        .map((r) => ({ id: String(r.id), boardId: String(r.boardId), name: String(r.name || ''), createdAt: Number(r.createdAt || 0) }))
        .sort((a, b) => a.createdAt - b.createdAt)
    } catch (e) {
      console.warn('[participants] loadAll failed', e)
      return []
    }
  }

  async function saveAll(list: Participant[]) {
    try {
      await dbBulkPut(STORE, list)
    } catch (e) {
      console.warn('[participants] saveAll failed', e)
    }
  }

  initPromise = (async () => {
    hydrating = true
    try {
      items.value = await loadAll()
    } finally {
      hydrating = false
    }
  })()

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    items,
    (list) => {
      if (hydrating) return
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void saveAll(list), 200)
    },
    { deep: true }
  )

  function list(boardId: string): Participant[] {
    return items.value.filter((p) => p.boardId === boardId)
  }

  function ensureDefaults(boardId: string) {
    const existing = list(boardId)
    if (existing.length > 0) return
    const now = Date.now()
    const me = { id: 'me', boardId, name: 'Bob', createdAt: now }
    const alice = { id: shortId(), boardId, name: 'Alice', createdAt: now + 1 }
    items.value.push(me as Participant, alice as Participant)
    void saveAll(items.value)
  }

  function add(boardId: string, name: string): Participant {
    const p: Participant = { id: shortId(), boardId, name: String(name || '').trim(), createdAt: Date.now() }
    items.value.push(p)
    void dbPut(STORE, p)
    return p
  }

  async function rename(boardId: string, id: string, name: string) {
    const idx = items.value.findIndex((p) => p.boardId === boardId && p.id === id)
    if (idx === -1) return
    items.value[idx].name = String(name || '')
    await dbPut(STORE, items.value[idx])
  }

  async function remove(boardId: string, id: string) {
    const idx = items.value.findIndex((p) => p.boardId === boardId && p.id === id)
    if (idx === -1) return
    items.value.splice(idx, 1)
    await dbDelete(STORE, id)
  }

  async function removeByBoard(boardId: string) {
    const ids = items.value.filter((p) => p.boardId === boardId).map((p) => p.id)
    items.value = items.value.filter((p) => p.boardId !== boardId)
    await dbBulkDelete(STORE, ids)
  }

  async function replaceForBoard(boardId: string, parts: { id: string; name: string }[]) {
    // Replace all participants for this board with provided list
    const existingIds = items.value.filter((p) => p.boardId === boardId).map((p) => p.id)
    // Remove existing
    if (existingIds.length) {
      items.value = items.value.filter((p) => p.boardId !== boardId)
      try { await dbBulkDelete(STORE, existingIds) } catch {}
    }
    const now = Date.now()
    const next: Participant[] = (Array.isArray(parts) ? parts : []).map((r, i) => ({
      id: String(r.id),
      boardId,
      name: String(r.name || ''),
      createdAt: now + i,
    }))
    if (next.length) {
      items.value.push(...next)
      try { await dbBulkPut(STORE, next) } catch {}
    }
  }

  return {
    items,
    ensureLoaded: async () => { if (initPromise) await initPromise },
    list,
    ensureDefaults,
    add,
    rename,
    remove,
    removeByBoard,
  replaceForBoard,
  }
})
