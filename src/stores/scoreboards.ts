import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { nowUtc } from '@/time-sync'
import { subscribeTag, send as nostrSend } from '@/nostr'
import { useUserStore } from '@/stores/user'
import { toast } from 'vue-sonner'

export interface Scoreboard {
  id: string
  name: string
  createdAt: number
  authorPubKey: string
}

export const useScoreboardsStore = defineStore('scoreboards', () => {
  const items = ref<Scoreboard[]>([])
  // nostr subscriptions cleanup map
  const unsubById = new Map<string, () => void>()
  // internal: indicates hydration in progress to avoid write loops
  let hydrating = false
  // expose a readiness promise to let router/pages wait for initial load
  let initPromise: Promise<void> | null = null

  // IndexedDB helpers (lazy)
  const DB_NAME = 'appdb'
  const DB_VERSION = 2
  const STORE = 'scoreboards'
  let idb: IDBDatabase | null = null

  function openIdb(name: string, version: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
        // Keep other app stores created too, in case this is the first opener
        if (!db.objectStoreNames.contains('user')) {
          db.createObjectStore('user', { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async function ensureDb(): Promise<IDBDatabase | null> {
    if (idb) return idb
    try {
      idb = await openIdb(DB_NAME, DB_VERSION)
      return idb
    } catch (e) {
      console.warn('[scoreboards] IndexedDB unavailable, persistence disabled', e)
      return null
    }
  }

  async function loadAll(): Promise<Scoreboard[] | null> {
    const db = await ensureDb()
    if (!db) return null
    try {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const values: any[] = await new Promise((resolve, reject) => {
        const req = store.getAll()
        req.onsuccess = () => resolve(req.result as any[])
        req.onerror = () => reject(req.error)
      })
      // ensure createdAt is a number and sort asc
      return values
        .map((v) => ({ id: String(v.id), name: String(v.name), createdAt: Number(v.createdAt), authorPubKey: String(v.authorPubKey || '') }))
        .sort((a, b) => a.createdAt - b.createdAt)
    } catch (e) {
      console.warn('[scoreboards] loadAll failed', e)
      return null
    }
  }

  async function saveAll(list: Scoreboard[]) {
    const db = await ensureDb()
    if (!db) return
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const sb of list) {
        store.put({ id: sb.id, name: sb.name, createdAt: sb.createdAt, authorPubKey: sb.authorPubKey })
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } catch (e) {
      console.warn('[scoreboards] saveAll failed', e)
    }
  }

  function addScoreboard(name: string): Scoreboard {
    const id = crypto.randomUUID()
    const user = useUserStore()
    const authorPubKey = user.getPubKey() || ''

    const sb: Scoreboard = {
      id,
      name,
      createdAt: nowUtc(),
      authorPubKey,
    }
    items.value.push(sb)
    // persist eagerly for immediate durability
    // (watcher also persists, but this speeds up single-add cases)
    void saveAll(items.value)
    // subscribe to join requests for this scoreboard
    subscribeJoinTagFor(id)
    return sb
  }

  async function deleteScoreboard(id: string): Promise<boolean> {
    const idx = items.value.findIndex((s) => s.id === id)
    if (idx === -1) return false

    // remove from in-memory list first for immediate UI feedback
    items.value.splice(idx, 1)

    // delete persisted record as well
    try {
      const db = await ensureDb()
      if (!db) return true
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.delete(id)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } catch (e) {
      console.warn('[scoreboards] delete failed', e)
    }

    return true
  }

  // hydrate from IndexedDB on first use
  initPromise = (async () => {
    hydrating = true
    try {
      const rows = await loadAll()
      if (rows && rows.length) {
        items.value = rows
  // subscribe for all existing
        for (const sb of items.value) subscribeJoinTagFor(sb.id)
      }
    } finally {
      hydrating = false
    }
  })()

  // persist on any change (debounced)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    items,
    (list) => {
      if (hydrating) return
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        void saveAll(list)
      }, 200)
    },
    { deep: true }
  )

  function subscribeJoinTagFor(id: string) {
    const tag = `lik-sb-join-req-${id}`
    // close existing if any
    if (unsubById.has(id)) {
      try { unsubById.get(id)!() } catch {}
      unsubById.delete(id)
    }
    const unsub = subscribeTag(tag)
    unsubById.set(id, unsub)
  }

  function startJoinSubscriptions() {
    // ensure all current items are subscribed (idempotent)
    for (const sb of items.value) subscribeJoinTagFor(sb.id)
  }

  function stopJoinSubscriptions() {
    for (const [id, fn] of unsubById.entries()) {
      try { fn() } catch {}
      unsubById.delete(id)
    }
  }

  /**
   * Join a scoreboard by a code like "lik-<id>".
   * - If the scoreboard is already in user's list and they are the author: show error toast.
   * - If it's already in the list but not authored by the user: show info toast.
   * - Otherwise, send a Nostr join request tagged with lik-sb-join-req-<id>.
   */
  async function join(code: string): Promise<{ ok: boolean; reason?: 'own' | 'already' | 'bad-code' | 'no-keys' }> {
    const raw = String(code || '').trim()
    // Extract scoreboard id from code
    const m = /^lik-([0-9a-fA-F-]{8,})$/.exec(raw)
    if (!m) {
      toast.error('Invalid code', { description: 'Use a code starting with "lik-"' })
      return { ok: false, reason: 'bad-code' }
    }
    const id = m[1]

    // Check duplicates/ownership
    const existing = items.value.find((s) => s.id === id)
    const user = useUserStore()
    const myPub = user.getPubKey() || ''
    if (existing) {
      if (existing.authorPubKey && existing.authorPubKey === myPub) {
        toast.error('You cant join own scoreboard')
        return { ok: false, reason: 'own' }
      }
      toast.info('You have already joinde this scoreboard')
      return { ok: false, reason: 'already' }
    }

    // Ensure keys
    const profile = await user.ensureUser()
    const pub = profile.pubkeyHex
    const priv = profile.privkeyHex
    if (!pub || !priv) {
      toast.error('Profile not ready', { description: 'Missing keys to send join request.' })
      return { ok: false, reason: 'no-keys' }
    }

    // Send join request on Nostr
    const tag = `lik-sb-join-req-${id}`
    try {
      await nostrSend(pub, priv, 1, `join-request ${id}`, [[ 't', tag ]])
      toast.success('Join request sent', { description: `Waiting for approval…` })
      return { ok: true }
    } catch (e) {
      console.warn('[scoreboards] join send failed', e)
      toast.error('Failed to send request', { description: 'Please try again.' })
      return { ok: false }
    }
  }

  return {
    items,
    addScoreboard,
    deleteScoreboard,
    // allow consumers to await initial load completion
    ensureLoaded: async () => { if (initPromise) await initPromise },
    // nostr helpers
    startJoinSubscriptions,
    stopJoinSubscriptions,
    join,
  }
})
