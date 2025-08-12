import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { nowUtc } from '@/time-sync'
import { subscribeTag, send as nostrSend, fetchLatestProfile } from '@/nostr'
import { useUserStore } from '@/stores/user'
import { toast } from 'vue-sonner'
import { useProfilesStore } from '@/stores/profiles'
import { dbGetAll, dbBulkPut, dbDelete, dbPut } from '@/lib/idb'

export interface Scoreboard {
  id: string
  name: string
  createdAt: number
  authorPubKey: string
  // members list of approved pubkeys
  members?: string[]
}

export const useScoreboardsStore = defineStore('scoreboards', () => {
  const items = ref<Scoreboard[]>([])
  // nostr subscriptions cleanup map
  const unsubById = new Map<string, () => void>()
  // last join requests per scoreboard id
  const lastRequests = ref<Record<string, JoinReq[]>>({})
  // blacklist of rejected join request ids with TTL
  const rejected = ref<Map<string, number>>(new Map())
  // internal: indicates hydration in progress to avoid write loops
  let hydrating = false
  // expose a readiness promise to let router/pages wait for initial load
  let initPromise: Promise<void> | null = null

  // IndexedDB helpers (lazy)
  const DB_NAME = 'appdb'
  const DB_VERSION = 3
  const STORE = 'scoreboards'
  const REJECT_STORE = 'rejectedScoreboardRequests'
  // no local ensureDb; use lib/idb.ts

  async function loadAll(): Promise<Scoreboard[] | null> {
    try {
      const values: any[] = await dbGetAll<any>(STORE)
      // ensure createdAt is a number and sort asc
      return values
        .map((v) => ({ id: String(v.id), name: String(v.name), createdAt: Number(v.createdAt), authorPubKey: String(v.authorPubKey || ''), members: Array.isArray(v.members) ? v.members.map(String) : [] }))
        .sort((a, b) => a.createdAt - b.createdAt)
    } catch (e) {
      console.warn('[scoreboards] loadAll failed', e)
      return null
    }
  }

  async function saveAll(list: Scoreboard[]) {
    try {
      await dbBulkPut(
        STORE,
        list.map((sb) => ({ id: sb.id, name: sb.name, createdAt: sb.createdAt, authorPubKey: sb.authorPubKey, members: Array.isArray(sb.members) ? sb.members : [] }))
      )
    } catch (e) {
      console.warn('[scoreboards] saveAll failed', e)
    }
  }

  // rejected store helpers
  type RejectedRow = { id: string; expiresAt: number }
  const TTL_MS = 5 * 24 * 60 * 60 * 1000 // 5 days

  async function loadRejected(): Promise<RejectedRow[]> {
    try {
      return await dbGetAll<RejectedRow>(REJECT_STORE)
    } catch (e) {
      console.warn('[scoreboards] loadRejected failed', e)
      return []
    }
  }

  async function saveRejected(id: string, expiresAt: number) {
    try {
      await dbPut(REJECT_STORE, { id, expiresAt })
    } catch (e) {
      console.warn('[scoreboards] saveRejected failed', e)
    }
  }

  async function purgeExpiredRejected() {
    const rows = await loadRejected()
    const now = Date.now()
    for (const r of rows) {
      if (r.expiresAt <= now) {
        try { await dbDelete(REJECT_STORE, r.id) } catch {}
      }
    }
  }

  function isRejected(eventId: string): boolean {
    const exp = rejected.value.get(eventId)
    if (!exp) return false
    if (exp <= Date.now()) {
      rejected.value.delete(eventId)
      // cleanup persisted later
      return false
    }
    return true
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
      members: [],
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
      await dbDelete(STORE, id)
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
      // load rejected blacklist
      try {
        await purgeExpiredRejected()
        const rowsR = await loadRejected()
        rejected.value.clear()
        const now = Date.now()
        for (const r of rowsR) if (r.expiresAt > now) rejected.value.set(r.id, r.expiresAt)
      } catch (e) {
        console.warn('[scoreboards] rejected load failed', e)
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

  // Keep profiles store subscribed to all members across scoreboards
  watch(
    items,
    (list) => {
      try {
        const prof = useProfilesStore()
        const allMembers = new Set<string>()
        for (const sb of list) {
          if (Array.isArray(sb.members)) for (const m of sb.members) if (m) allMembers.add(String(m))
          if (sb.authorPubKey) allMembers.add(String(sb.authorPubKey))
        }
        prof.setTrackedPubkeys(Array.from(allMembers))
      } catch {}
    },
    { deep: true, immediate: true }
  )

  type JoinReq = { id: string; pubkey: string; createdAt: number; name?: string; picture?: string }

  function pushJoinRequest(boardId: string, req: JoinReq) {
    const list = lastRequests.value[boardId] || []
    // dedupe by event id
    if (list.some((r) => r.id === req.id)) return
    const next = [...list, req].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3)
    lastRequests.value = { ...lastRequests.value, [boardId]: next }
  }

  function subscribeJoinTagFor(id: string) {
    const tag = `lik-sb-join-req-${id}`
    // close existing if any
    if (unsubById.has(id)) {
      try { unsubById.get(id)!() } catch {}
      unsubById.delete(id)
    }
    const unsub = subscribeTag(tag, async (evt: any) => {
      // Expect a kind 1 note with content like "join-request <id>"
      try {
        const evtId = String(evt?.id || '')
        const pubkey = String(evt?.pubkey || '')
        const createdAt = Number(evt?.created_at || 0)
        if (!evtId || !pubkey) return
        if (isRejected(evtId)) return
        // Fetch latest profile and only include if has some info
        try {
          const prof = await fetchLatestProfile(pubkey, 2500)
          const data: any = prof?.data || {}
          const name = String(data?.name || data?.display_name || data?.username || '')
          const picture = String(data?.picture || '')
          if (!name && !picture) return // ignore join request without profile info
          pushJoinRequest(id, { id: evtId, pubkey, createdAt, name, picture })
        } catch {
          // ignore on failure
        }
      } catch {}
    })
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

  function isOwner(boardId: string, myPub: string | null): boolean {
    const sb = items.value.find((s) => s.id === boardId)
    if (!sb || !myPub) return false
    return sb.authorPubKey === myPub
  }

  async function approve(boardId: string, eventId: string, pubkey: string) {
    const sb = items.value.find((s) => s.id === boardId)
    if (!sb) return
    if (!Array.isArray(sb.members)) sb.members = []
    if (!sb.members.includes(pubkey)) sb.members.push(pubkey)
    await saveAll(items.value)
    // remove from lastRequests
    const list = lastRequests.value[boardId] || []
    lastRequests.value = { ...lastRequests.value, [boardId]: list.filter((r) => r.id !== eventId) }
  }

  async function reject(boardId: string, eventId: string) {
    const exp = Date.now() + TTL_MS
    rejected.value.set(eventId, exp)
    await saveRejected(eventId, exp)
    // remove from visible requests
    const list = lastRequests.value[boardId] || []
    lastRequests.value = { ...lastRequests.value, [boardId]: list.filter((r) => r.id !== eventId) }
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
  lastRequests,
    addScoreboard,
    deleteScoreboard,
    // allow consumers to await initial load completion
    ensureLoaded: async () => { if (initPromise) await initPromise },
    // nostr helpers
    startJoinSubscriptions,
    stopJoinSubscriptions,
    join,
  isOwner,
  approve,
  reject,
  }
})
