import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { nowUtc } from '@/time-sync'
import { subscribeTag, send as nostrSend, fetchLatestProfile, publishPREToRelays, fetchLatestPREByDTag, RELAYS } from '@/nostr'
import { SimplePool } from 'nostr-tools/pool'
import { useUserStore } from '@/stores/user'
import { toast } from 'vue-sonner'
import { useProfilesStore } from '@/stores/profiles'
import { dbGetAll, dbBulkPut, dbDelete, dbPut } from '@/lib/idb'
import { subscribeToBoard as subscribeCRDT } from '@/nostrToCRDT'
import shortId from '@/lib/utils'

export interface Scoreboard {
  id: string
  name: string
  createdAt: number
  authorPubKey: string
  // members list of approved pubkeys
  members?: string[]
  // CRDT snapshot (EndingState) for the board
  snapshot?: any
  // Local participants used in scoring: [{ id, name }]
  participants?: { id: string; name: string }[]
}

export const useScoreboardsStore = defineStore('scoreboards', () => {
  const items = ref<Scoreboard[]>([])
  // nostr subscriptions cleanup map
  const unsubById = new Map<string, () => void>()
  // CRDT PRE subscriptions by board id
  const crdtUnsubById = new Map<string, () => void>()
  // Board metadata PRE subscriptions by board id
  const brdUnsubById = new Map<string, () => void>()
  const brdPool = new SimplePool()
  const KIND_PRE = 30078
  // last join requests per scoreboard id
  const lastRequests = ref<Record<string, JoinReq[]>>({})
  // blacklist of rejected join request ids with TTL
  const rejected = ref<Map<string, number>>(new Map())
  // internal: indicates hydration in progress to avoid write loops
  let hydrating = false
  // expose a readiness promise to let router/pages wait for initial load
  let initPromise: Promise<void> | null = null
  // track serialized signature of board fields to detect changes
  const boardSig = new Map<string, string>()

  // IndexedDB helpers (lazy)
  const STORE = 'scoreboards'
  const REJECT_STORE = 'rejectedScoreboardRequests'
  // no local ensureDb; use lib/idb.ts

  async function loadAll(): Promise<Scoreboard[] | null> {
    try {
      const values: any[] = await dbGetAll<any>(STORE)
      // ensure createdAt is a number and sort asc
      return values
        .map((v) => ({
          id: String(v.id),
          name: String(v.name),
          createdAt: Number(v.createdAt),
          authorPubKey: String(v.authorPubKey || ''),
          members: Array.isArray(v.members) ? v.members.map(String) : [],
          snapshot: v.snapshot ?? undefined,
          participants: Array.isArray(v.participants) ? v.participants.map((p: any) => ({ id: String(p.id), name: String(p.name || '') })) : [],
        }))
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
        list.map((sb) => ({
          id: sb.id,
          name: sb.name,
          createdAt: sb.createdAt,
          authorPubKey: sb.authorPubKey,
          members: Array.isArray(sb.members) ? sb.members : [],
          snapshot: sb.snapshot,
          participants: Array.isArray(sb.participants) ? sb.participants : [],
        }))
      )
    } catch (e) {
      console.warn('[scoreboards] saveAll failed', e)
    }
  }

  // rejected store helpers
  type RejectedRow = { id: string; expiresAt: number }
  const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

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
      // include owner as a member immediately for simpler rendering/logic
      members: authorPubKey ? [authorPubKey] : [],
      participants: [
        { id: shortId(), name: 'Bob' },
        { id: shortId(), name: 'Alice' },
      ],
    }
    items.value.push(sb)
    // persist eagerly for immediate durability
    // (watcher also persists, but this speeds up single-add cases)
    void saveAll(items.value)
    // subscribe to join requests for this scoreboard
    subscribeJoinTagFor(id)
  // Owner publishes board metadata PRE to ensure availability
  void ensureBoardPREPublished(id).catch(() => {})
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

  // participants are embedded; nothing else to cleanup

    return true
  }

  /**
   * Update and persist a single scoreboard snapshot explicitly.
   * Useful for CRDT merges where we want immediate durability without waiting for the watcher.
   */
  async function updateSnapshot(id: string, snapshot: any): Promise<void> {
    const idx = items.value.findIndex((s) => s.id === id)
    if (idx === -1) return
    items.value[idx].snapshot = snapshot
    // Persist only this record to IDB to avoid extra churn
    try {
      await dbPut(STORE, {
        id: items.value[idx].id,
        name: items.value[idx].name,
        createdAt: items.value[idx].createdAt,
        authorPubKey: items.value[idx].authorPubKey,
        members: Array.isArray(items.value[idx].members) ? items.value[idx].members : [],
        snapshot: items.value[idx].snapshot,
        participants: Array.isArray(items.value[idx].participants) ? items.value[idx].participants : [],
      })
    } catch (e) {
      console.warn('[scoreboards] updateSnapshot failed', e)
    }
  }

  // ---------- Board PRE (lik::brd::<id>) helpers ----------
  type BoardPRE = { id: string; name: string; owner: string; members: string[]; participants?: { id: string; name: string }[] }
  function buildBoardPREPayload(boardId: string): BoardPRE | null {
    const sb = items.value.find((s) => s.id === boardId)
    if (!sb) return null
    return {
      id: sb.id,
      name: sb.name,
      owner: sb.authorPubKey,
      members: Array.isArray(sb.members) ? sb.members.slice() : [],
      participants: (sb.participants || []).map((p) => ({ id: p.id, name: p.name })),
    }
  }

  async function ensureBoardPREPublished(boardId: string) {
    const user = useUserStore()
    const me = user.getPubKey()
    const sb = items.value.find((s) => s.id === boardId)
    if (!sb || !me) return
    if (sb.authorPubKey !== me) return // only owner publishes
    const p = await user.ensureUser()
    const tag = `lik::brd::${boardId}`
    const payload = buildBoardPREPayload(boardId)
    if (!payload) return
    try {
      await publishPREToRelays(p.pubkeyHex, p.privkeyHex, tag, payload, RELAYS)
    } catch (e) {
      console.warn('[scoreboards] ensureBoardPREPublished failed', e)
    }
  }

  /** On scoreboard mount: if PRE exists but missing on some relays, republish to them. */
  async function verifyBoardPREEverywhere(boardId: string) {
    const sb = items.value.find((s) => s.id === boardId)
    const me = useUserStore().getPubKey()
    if (!sb || !me) return
    const tag = `lik::brd::${boardId}`
    // Non-owner can't publish; just no-op
    if (sb.authorPubKey !== me) return
    await ensureBoardPREPublished(boardId)
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

  // Auto-publish board PRE by owner when name/members change
  let preTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    items,
    () => {
      if (hydrating) return
      if (preTimer) clearTimeout(preTimer)
      preTimer = setTimeout(() => {
        try {
          const me = useUserStore().getPubKey()
          for (const sb of items.value) {
            if (!me || sb.authorPubKey !== me) continue
            const sig = JSON.stringify({ n: sb.name, o: sb.authorPubKey, m: (sb.members || []).slice().sort() })
            const prev = boardSig.get(sb.id)
            if (sig !== prev) {
              boardSig.set(sb.id, sig)
              void ensureBoardPREPublished(sb.id)
            }
          }
        } catch {}
      }, 300)
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

  // CRDT subscriptions management
  function subscribeBoardCRDT(boardId: string) {
    // close existing
    if (crdtUnsubById.has(boardId)) {
      try { crdtUnsubById.get(boardId)!() } catch {}
      crdtUnsubById.delete(boardId)
    }
    const sb = items.value.find((s) => s.id === boardId)
    if (!sb) return
    const members = Array.isArray(sb.members) ? sb.members : []
    try {
      const unsub = subscribeCRDT(boardId, members)
      crdtUnsubById.set(boardId, unsub)
    } catch {}
  }

  function unsubscribeBoardCRDT(boardId: string) {
    if (!crdtUnsubById.has(boardId)) return
    try { crdtUnsubById.get(boardId)!() } catch {}
    crdtUnsubById.delete(boardId)
  }

  function stopAllCRDTSubscriptions() {
    for (const [id, fn] of crdtUnsubById.entries()) {
      try { fn() } catch {}
      crdtUnsubById.delete(id)
    }
  }

  // Board metadata PRE subscription
  function subscribeBoardMeta(boardId: string, ownerPubkey?: string) {
    if (brdUnsubById.has(boardId)) {
      try { brdUnsubById.get(boardId)!() } catch {}
      brdUnsubById.delete(boardId)
    }
    const dTag = `lik::brd::${boardId}`
    const filter: any = { kinds: [KIND_PRE], '#d': [dTag] }
    if (ownerPubkey) filter.authors = [String(ownerPubkey)]
    const sub = brdPool.subscribeMany(RELAYS, [filter], {
      onevent: (evt: any) => {
        try {
          const content = String(evt?.content || '{}')
          const meta = JSON.parse(content)
          const sb = items.value.find((s) => s.id === boardId)
          if (!sb) return
          // Update fields if changed
          const nextName = String(meta?.name || sb.name)
          const nextOwner = String(meta?.owner || sb.authorPubKey)
          const nextMembers = Array.isArray(meta?.members) ? meta.members.map(String) : (sb.members || [])
          let changed = false
          if (sb.name !== nextName) { sb.name = nextName; changed = true }
          if (sb.authorPubKey !== nextOwner) { sb.authorPubKey = nextOwner; changed = true }
          const curMembers = (sb.members || []).slice().sort().join(',')
          const newMembers = nextMembers.slice().sort().join(',')
          if (curMembers !== newMembers) { sb.members = nextMembers; changed = true }
          if (changed) void saveAll(items.value)
          // Sync participants if present
          try {
            if (Array.isArray(meta?.participants)) {
              const list = meta.participants.map((p: any) => ({ id: String(p.id), name: String(p.name || '') }))
              const sb2 = items.value.find((s) => s.id === boardId)
              if (sb2) {
                sb2.participants = list
                void saveAll(items.value)
              }
            }
          } catch {}
        } catch {}
      },
      oneose: () => {
        // keep open
      },
    })
    brdUnsubById.set(boardId, () => { try { sub.close() } catch {} })
  }

  function unsubscribeBoardMeta(boardId: string) {
    if (!brdUnsubById.has(boardId)) return
    try { brdUnsubById.get(boardId)!() } catch {}
    brdUnsubById.delete(boardId)
  }

  function stopAllBoardMetaSubscriptions() {
    for (const [id, fn] of brdUnsubById.entries()) {
      try { fn() } catch {}
      brdUnsubById.delete(id)
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
  // Owner updates should re-publish board PRE
  void ensureBoardPREPublished(boardId)
    // remove from lastRequests
    const list = lastRequests.value[boardId] || []
    lastRequests.value = { ...lastRequests.value, [boardId]: list.filter((r) => r.id !== eventId) }
    // also ignore this request id going forward (same as rejected), with TTL
    const exp = Date.now() + TTL_MS
    rejected.value.set(eventId, exp)
    await saveRejected(eventId, exp)
  }

  async function reject(boardId: string, eventId: string) {
    const exp = Date.now() + TTL_MS
    rejected.value.set(eventId, exp)
    await saveRejected(eventId, exp)
    // remove from visible requests
    const list = lastRequests.value[boardId] || []
    lastRequests.value = { ...lastRequests.value, [boardId]: list.filter((r) => r.id !== eventId) }
  }

  async function renameBoard(boardId: string, newName: string) {
    const n = (newName ?? '').trim()
    if (!n) return
    const sb = items.value.find((s) => s.id === boardId)
    if (!sb) return
    sb.name = n
    await saveAll(items.value)
    // owner refresh publish
    void ensureBoardPREPublished(boardId)
  }

  /**
   * Join a scoreboard by a code like "lik-<id>".
   * - If the scoreboard is already in user's list and they are the author: show error toast.
   * - If it's already in the list but not authored by the user: show info toast.
   * - Otherwise, send a Nostr join request tagged with lik-sb-join-req-<id>.
   */
  async function join(code: string): Promise<{ ok: boolean; boardId?: string; reason?: 'own' | 'already' | 'bad-code' | 'no-keys' | 'bad-meta' }> {
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
      
      // Immediately fetch two PREs and cache locally:
      // 1) lik::brd::<id> board metadata (owner publishes)
      // 2) lik::crdt::<id> snapshot (anyone may publish; we use latest)
      try {
        const boardTag = `lik::brd::${id}`
        const { event: brdEvt } = await fetchLatestPREByDTag(boardTag)
        if (brdEvt && typeof brdEvt.content === 'string') {
          try {
            const meta = JSON.parse(brdEvt.content)
            if (!meta) {
              console.error('Invalid board metadata')
              return { ok: false, reason: 'bad-meta' }
            }
            if (!Array.isArray(meta.members)) {
              return { ok: false, reason: 'bad-meta' }
            }
            // We already returned earlier if this board existed; create local placeholder
            const sb: Scoreboard = {
              id,
              name: String(meta.name),
              createdAt: nowUtc(),
              authorPubKey: String(meta.owner),
              members: meta.members.map(String),
              participants: Array.isArray(meta.participants)
                ? meta.participants.map((p: any) => ({ id: String(p.id), name: String(p.name || '') }))
                : [],
            }
            items.value.push(sb)
            // tighten subscription to owner if known
            subscribeBoardMeta(id, sb.authorPubKey)
          } catch {}
        }

        const crdtTag = `lik::crdt::${id}`
        const { event: crdtEvt } = await fetchLatestPREByDTag(crdtTag)
        if (crdtEvt && typeof crdtEvt.content === 'string') {
          try {
            const snapshot = JSON.parse(crdtEvt.content)
            const idx = items.value.findIndex((s) => s.id === id)
            if (idx !== -1) items.value[idx].snapshot = snapshot
          } catch {}
        }

        // persist any changes
        await saveAll(items.value)
        // subscribe to board CRDT updates immediately
        subscribeBoardCRDT(id)
      } catch (e) {
        console.warn('[scoreboards] join: PRE prefetch failed', e)
      }

      toast.success('Join request sent', { description: `Waiting for approval…` })
      return { ok: true, boardId: id }
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
    updateSnapshot,
    verifyBoardPREEverywhere,
    ensureBoardPREPublished,
    // allow consumers to await initial load completion
    ensureLoaded: async () => { if (initPromise) await initPromise },
    // nostr helpers
    startJoinSubscriptions,
    stopJoinSubscriptions,
    subscribeBoardCRDT,
    unsubscribeBoardCRDT,
    stopAllCRDTSubscriptions,
    subscribeBoardMeta,
    unsubscribeBoardMeta,
    stopAllBoardMetaSubscriptions,
    join,
    isOwner,
    approve,
    reject,
    renameBoard,
  }
})
