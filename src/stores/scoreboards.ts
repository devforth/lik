import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { nowUtc } from '@/time-sync'
import { nostrSubscribeTag, send as nostrSend, fetchLatestProfile, publishPREToRelays, fetchLatestPREByDTag, RELAYS } from '@/nostr'
import { SimplePool } from 'nostr-tools/pool'
import { useUserStore } from '@/stores/user'
import { toast } from 'vue-sonner'
import { useProfilesStore } from '@/stores/profiles'
import { dbGetAll, dbBulkPut, dbDelete, dbPut } from '@/lib/idb'
import { subscribeToBoardCRDT, appendLogEvent as appendLogEventCRDT } from '@/nostrToCRDT'
import type { LogEntry as CRDTLogEntry } from '@/crdt'
import shortId from '@/lib/utils'

export interface Scoreboard {
  id: string
  name: string
  createdAt: number
  authorPubKey: string
  // editors list of approved pubkeys
  editors: string[]
  // CRDT snapshot (EndingState) for the board
  snapshot?: any
  // Local participants used in scoring: [{ id, name }]
  participants?: { id: string; name: string }[]
  // Secret (AES) for encrypting board data and join requests; never published
  secret: string
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
  // expose a readiness promise to let router/pages wait for initial load (lazy init)
  let __initPromise: Promise<void> | undefined
  // track serialized signature of board fields to detect changes
  const boardSig = new Map<string, string>()
  // track CRDT subscription authors signature per board to avoid needless resubscribes
  const crdtSigById = new Map<string, string>()

  // IndexedDB helpers (lazy)
  const STORE = 'scoreboards'
  const REJECT_STORE = 'rejectedScoreboardRequests'
  // no local ensureDb; use lib/idb.ts

  async function loadAll(): Promise<Scoreboard[] | null> {
    try {
      const values: any[] = await dbGetAll<any>(STORE)
      // Map and drop any boards without a valid secret (we don't support legacy data)
      const mapped = values.map((v) => ({
        id: String(v.id),
        name: String(v.name),
        createdAt: Number(v.createdAt),
        authorPubKey: String(v.authorPubKey || ''),
        editors: Array.isArray((v as any).editors) ? (v as any).editors.map(String) : [],
        snapshot: v.snapshot ?? undefined,
        participants: Array.isArray(v.participants) ? v.participants.map((p: any) => ({ id: String(p.id), name: String(p.name || '') })) : [],
        secret: String(v.secret || ''),
      }))
      const filtered: Scoreboard[] = mapped.filter((m) => !!m.secret)
      return filtered.sort((a, b) => a.createdAt - b.createdAt)
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
          editors: Array.isArray(sb.editors) ? sb.editors : [],
          snapshot: sb.snapshot,
          participants: Array.isArray(sb.participants) ? sb.participants : [],
          // persist secret locally only
          secret: sb.secret,
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

  async function createScoreboard(name: string): Promise<Scoreboard> {
    const id = crypto.randomUUID()
    const user = useUserStore()
    const authorPubKey = user.getPubKey() || ''
    const ownerPriv = user.getPrivKey() || ''
    // Secret generation: sha-512 of `${priv}::${boardId}`
    // Note: priv is hex; secret is hex string
    const rawForSecret = `${ownerPriv}::${id}`

    // Derive secret before constructing the scoreboard
    const { sha512Hex } = await import('@/lib/utils')
    const secretHex = await sha512Hex(rawForSecret)

    const sb: Scoreboard = {
      id,
      name,
      createdAt: nowUtc(),
      authorPubKey,
      // include owner as an editor immediately for simpler rendering/logic
      editors: authorPubKey ? [authorPubKey] : [],
      participants: [
        { id: shortId(), name: 'Bob' },
        { id: shortId(), name: 'Alice' },
      ],
      secret: secretHex,
    }
    // persist eagerly for immediate durability
    await saveAll([...(items.value || []), sb])
    items.value.push(sb)
    // subscribe to join requests for this scoreboard
    subscribeJoinTagFor(id)

    // Publish encrypted board metadata PRE
    void ensureBoardPREPublished(id, 'scoreboards.createScoreboard').catch(() => {})
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
        editors: Array.isArray(items.value[idx].editors) ? items.value[idx].editors : [],
        snapshot: items.value[idx].snapshot,
        participants: Array.isArray(items.value[idx].participants) ? items.value[idx].participants : [],
        secret: items.value[idx].secret,
      })
    } catch (e) {
      console.warn('[scoreboards] updateSnapshot failed', e)
    }
  }

  // ---------- Board PRE (lik::brd::<id>) helpers (encrypted content) ----------
  type BoardPRE = { id: string; name: string; owner: string; editors: string[]; participants?: { id: string; name: string }[] }
  function buildBoardPREPayload(boardId: string): BoardPRE | null {
    const sb = items.value.find((s) => s.id === boardId)
    if (!sb) return null
    return {
      id: sb.id,
      name: sb.name,
      owner: sb.authorPubKey,
      editors: Array.isArray(sb.editors) ? sb.editors.slice() : [],
      participants: (sb.participants || []).map((p) => ({ id: p.id, name: p.name })),
    }
  }

  async function ensureBoardPREPublished(boardId: string, caller?: string) {
    const user = useUserStore()
    const me = user.getPubKey()
    const sb = items.value.find((s) => s.id === boardId)
    if (!sb || !me) { console.log('[scoreboards] ensureBoardPREPublished: missing sb or me'); return }
    if (sb.authorPubKey !== me) { console.log('[scoreboards] ensureBoardPREPublished: not owner'); return } // only owner publishes
    if (!sb.secret) {
      console.log('[scoreboards] ensureBoardPREPublished: secret not ready')
      // Secret not ready; skip for now (creator IIFE triggers again once secret is set)
      return
    }
    const p = await user.ensureUser()
    const tag = `lik::brd::${boardId}`
    const payload = buildBoardPREPayload(boardId)
    if (!payload) { console.log('[scoreboards] ensureBoardPREPublished: no payload'); return }
    try {
      // Encrypt metadata with board secret before publish
      const { aesEncryptToBase64 } = await import('@/lib/utils')
      const enc = await aesEncryptToBase64(String(sb.secret), JSON.stringify(payload))
      console.log('[scoreboards] ensureBoardPREPublished: publishing PRE', { pubkey: p.pubkeyHex, tag, payload, caller, boardId })
      await publishPREToRelays(p.pubkeyHex, p.privkeyHex, tag, enc, payload, RELAYS)
    } catch (e) {
      console.warn('[scoreboards] ensureBoardPREPublished failed', e)
    }
  }

  /** On scoreboard mount: if PRE exists but missing on some relays, republish to them. */
  async function verifyBoardPREEverywhere(boardId: string) {
    const sb = items.value.find((s) => s.id === boardId)
    const me = useUserStore().getPubKey()
    if (!sb || !me) return
    // Non-owner can't publish; just no-op
    if (sb.authorPubKey !== me) return
    await ensureBoardPREPublished(boardId, 'scoreboardMount, verifyBoardPREEverywhere'); 
  }

  // hydrate from IndexedDB on first use (lazy, idempotent)
  async function loadOnce() {
    if (__initPromise) return __initPromise
    __initPromise = (async () => {
      hydrating = true
      try {
        const rows = await loadAll()
        if (rows && rows.length) {
          items.value = rows
          // subscribe for existing boards only if I'm the owner
          const myPub = useUserStore().getPubKey() || ''
          for (const sb of items.value) {
            if (myPub && sb.authorPubKey === myPub) {
              subscribeJoinTagFor(sb.id)
            }
          }
        }
        // load rejected blacklist
        try {
          await purgeExpiredRejected()
          const rowsR = await loadRejected()
          rejected.value.clear()
          for (const r of rowsR) {
            rejected.value.set(r.id, r.expiresAt)
          }
        } catch (e) {
          console.warn('[scoreboards] rejected load failed', e)
        }
      } finally {
        hydrating = false
      }
    })()
    return __initPromise
  }

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

  // Auto-publish board PRE by owner when name/editors change
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
            const sig = JSON.stringify({ n: sb.name, o: sb.authorPubKey, e: (sb.editors || []).slice().sort() })
            const prev = boardSig.get(sb.id)
            if (sig !== prev) {
              boardSig.set(sb.id, sig)
              void ensureBoardPREPublished(sb.id, 'watch items in pinia scoreboards')
            }
          }
        } catch {}
      }, 300)
    },
    { deep: true }
  )

  // Keep profiles store subscribed to all editors across scoreboards
  watch(
    items,
    (list) => {
      try {
        const prof = useProfilesStore()
        const allMembers = new Set<string>()
        for (const sb of list) {
          for (const m of (sb.editors || [])) {
            if (m) {
              allMembers.add(String(m))
            }
          }
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
    const tag = `lik::sb-join-req::${id}`
    // close existing if any
    if (unsubById.has(id)) {
      try { unsubById.get(id)!() } catch {}
      unsubById.delete(id)
    }
    const unsub = nostrSubscribeTag(tag, async (evt: any) => {
      // Expect a kind 1 note with content like "join-request <id>"
      try {
        const evtId = String(evt?.id || '')
        const pubkey = String(evt?.pubkey || '')
        const createdAt = Number(evt?.created_at || 0)
        if (!evtId || !pubkey) return
        if (isRejected(evtId)) return
        // Decrypt join content with local secret; if decryption fails, ignore silently
        try {
          const content = String(evt?.content || '')
          const sb = items.value.find((s) => s.id === id)
          const secret = sb?.secret
          if (!secret) return // cannot validate without secret
          const { aesDecryptFromBase64 } = await import('@/lib/utils')
          const plain = await aesDecryptFromBase64(secret, content)
          // Expected JSON: { t: 'join-request', id }
          const obj = JSON.parse(plain)
          if (!obj || obj.t !== 'join-request' || String(obj.id) !== id) return
        } catch {
          return
        }
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
    const sb = items.value.find((s) => s.id === boardId)
    if (!sb) return
  // Use editors as-is; it includes the owner by convention
    if (!Array.isArray(sb.editors)) {
      throw new Error('Invalid editors array')
    }
    if (!sb.editors.length) {
      throw new Error('Empty editors array')
    }
    // Compute a stable signature of authors list to detect changes
    const sig = sb.editors.slice().sort().join(',')
    const prevSig = crdtSigById.get(boardId)
    if (prevSig === sig && crdtUnsubById.has(boardId)) {
      // Already subscribed with same authors; no-op
      return
    }
    // If signature changed, close previous subscription before opening a new one
    if (crdtUnsubById.has(boardId)) {
      try { crdtUnsubById.get(boardId)!() } catch {}
      crdtUnsubById.delete(boardId)
    }
    const unsub = subscribeToBoardCRDT(boardId, sb.editors)
    crdtUnsubById.set(boardId, unsub)
    crdtSigById.set(boardId, sig)
  }

  function unsubscribeBoardCRDT(boardId: string) {
    if (!crdtUnsubById.has(boardId)) return
    try { crdtUnsubById.get(boardId)!() } catch {}
    crdtUnsubById.delete(boardId)
  crdtSigById.delete(boardId)
  }

  function stopAllCRDTSubscriptions() {
    for (const [id, fn] of crdtUnsubById.entries()) {
      try { fn() } catch {}
      crdtUnsubById.delete(id)
  crdtSigById.delete(id)
    }
  }

  // Board metadata PRE subscription (decrypt with local secret)
  function subscribeBoardMeta(boardId: string, ownerPubkey?: string) {
    if (brdUnsubById.has(boardId)) {
      try { brdUnsubById.get(boardId)!() } catch {}
      brdUnsubById.delete(boardId)
    }
    const dTag = `lik::brd::${boardId}`
    const filter: any = { kinds: [KIND_PRE], '#d': [dTag] }
    if (ownerPubkey) {
      filter.authors = [String(ownerPubkey)]
    }
    const sub = brdPool.subscribeMany(RELAYS, [filter], {
      onevent: (evt: any) => {
        try {
          const content = String(evt?.content || '')
          const sb = items.value.find((s) => s.id === boardId)
          if (!sb || !sb.secret) return
          // Defense-in-depth: ensure only owner-authored metadata is processed
          const evtAuthor = String(evt?.pubkey || '')
          if (ownerPubkey && evtAuthor && evtAuthor !== String(ownerPubkey)) return
          // Decrypt metadata
          const metaStrPromise = import('@/lib/utils').then(({ aesDecryptFromBase64 }) => aesDecryptFromBase64(String(sb.secret), content))
          void (async () => {
            try {
              const metaStr = await metaStrPromise
              const meta = JSON.parse(metaStr)
              const sb2 = items.value.find((s) => s.id === boardId)
              if (!sb2) return
              // Validate owner consistency
              const metaOwner = String(meta?.owner || '')
              if (metaOwner && sb2.authorPubKey && metaOwner !== sb2.authorPubKey) {
                // If we already know an owner and it differs from meta, ignore this event
                return
              }
              // Update fields if changed
              const nextName = String(meta?.name || sb2.name)
              const nextOwner = String(meta?.owner || sb2.authorPubKey)
              const nextEditors = Array.isArray(meta?.editors) ? meta.editors.map(String) : (sb2.editors || [])
              let changed = false
              if (sb2.name !== nextName) { sb2.name = nextName; changed = true }
              if (sb2.authorPubKey !== nextOwner) { sb2.authorPubKey = nextOwner; changed = true }
              const curEditors = (sb2.editors || []).slice().sort().join(',')
              const newEditors = nextEditors.slice().sort().join(',')
              if (curEditors !== newEditors) { sb2.editors = nextEditors; changed = true }
              if (changed) void saveAll(items.value)
              // Sync participants if present
              try {
                if (Array.isArray(meta?.participants)) {
                  const list = meta.participants.map((p: any) => ({ id: String(p.id), name: String(p.name || '') }))
                  const sb3 = items.value.find((s) => s.id === boardId)
                  if (sb3) {
                    sb3.participants = list
                    void saveAll(items.value)
                  }
                }
              } catch {}
            } catch {}
          })()
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
    if (!Array.isArray(sb.editors)) sb.editors = []
    if (!sb.editors.includes(pubkey)) sb.editors.push(pubkey)
    await saveAll(items.value)
    // Owner updates should re-publish board PRE
    void ensureBoardPREPublished(boardId, 'approve invite')
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
    void ensureBoardPREPublished(boardId, 'rename board')
  }

  // ---------- Events log helpers ----------
  /** Append a log entry into CRDT snapshot.events and publish. Action: '+1' | '-1' | 'add-cat' | 'prio' | 'unprio' */
  async function addLogEvent(boardId: string, action: '+1' | '-1' | 'add-cat' | 'prio' | 'unprio', categoryId: string, participantId?: string | null) {
    const pub = useUserStore().getPubKey() || ''
    const tsSec = Math.floor(nowUtc() / 1000)
    const eid = shortId()
    const entry: CRDTLogEntry = [eid, pub, tsSec, String(categoryId || ''), action, participantId == null ? null : String(participantId)]
    // Append into CRDT snapshot.events and publish via CRDT channel so all editors can propagate
    try {
      appendLogEventCRDT(boardId, entry)
    } catch (e) {
      console.warn('[scoreboards] addLogEvent -> CRDT append failed', e)
    }
  }

  /**
   * Join a scoreboard by a code like "lik::<id>::<secret>".
   * - If the scoreboard is already in user's list and they are the author: show error toast.
   * - If it's already in the list but not authored by the user: show info toast.
   * - Otherwise, send a Nostr join request tagged with lik::sb-join-req::<id>, encrypted with the secret.
   */
  async function join(code: string): Promise<{ ok: boolean; boardId?: string; reason?: 'own' | 'already' | 'bad-code' | 'no-keys' | 'bad-meta' }> {
    const raw = String(code || '').trim()
    // Extract scoreboard id and secret from code lik::<id>::<secret>
    const m = /^lik::([0-9a-fA-F-]{8,})::([0-9a-fA-F]{64,})$/.exec(raw)
    if (!m) {
      toast.error('Invalid code', { description: 'Use a code like "lik::id::secret"' })
      return { ok: false, reason: 'bad-code' }
    }
    const id = m[1]
    const secret = m[2]

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

    // Send encrypted join request on Nostr
    const tag = `lik::sb-join-req::${id}`
    try {
      const payload = { t: 'join-request', id }
      const { aesEncryptToBase64 } = await import('@/lib/utils')
      const enc = await aesEncryptToBase64(secret, JSON.stringify(payload))
      await nostrSend(pub, priv, 1, enc, [[ 't', tag ]])
      
      // Immediately fetch two PREs and cache locally:
      // 1) lik::brd::<id> board metadata (owner publishes)
      // 2) lik::crdt::<id> snapshot (anyone may publish; we use latest)
      try {
        const boardTag = `lik::brd::${id}`
        const { event: brdEvt } = await fetchLatestPREByDTag(boardTag, null)
        if (brdEvt && typeof brdEvt.content === 'string') {
          try {
            // Decrypt board metadata with provided secret
            const { aesDecryptFromBase64 } = await import('@/lib/utils')
            const metaStr = await aesDecryptFromBase64(secret, String(brdEvt.content))
            const meta = JSON.parse(metaStr)
            if (!meta) {
              console.error('Invalid board metadata')
              return { ok: false, reason: 'bad-meta' }
            }
            if (!Array.isArray(meta.editors)) {
              return { ok: false, reason: 'bad-meta' }
            }
            // We already returned earlier if this board existed; create local placeholder
            const sb: Scoreboard = {
              id,
              name: String(meta.name),
              createdAt: nowUtc(),
              authorPubKey: String(meta.owner),
              editors: meta.editors.map(String),
              participants: Array.isArray(meta.participants)
                ? meta.participants.map((p: any) => ({ id: String(p.id), name: String(p.name || '') }))
                : [],
              secret,
            }
            items.value.push(sb)
            // tighten subscription to owner if known (onlhy owner can update meta)
            subscribeBoardMeta(id, sb.authorPubKey)
          } catch {}
        }

        const crdtTag = `lik::crdt::${id}`
        // Only prefetch CRDT after metadata was obtained so we can trust authors list
        const cur = items.value.find((s) => s.id === id)
        if (cur) {
          const allowedAuthors = [cur.authorPubKey, ...(cur.editors || [])].filter(Boolean)
          const { event: crdtEvt } = await fetchLatestPREByDTag(crdtTag, allowedAuthors.length ? allowedAuthors : null)
          if (crdtEvt && typeof crdtEvt.content === 'string') {
            try {
              let snapshot: any = null
              try {
                const { aesDecryptFromBase64 } = await import('@/lib/utils')
                const plain = await aesDecryptFromBase64(secret, crdtEvt.content)
                snapshot = JSON.parse(plain)
              } catch {
                // If decryption fails, treat as empty snapshot (cannot recover)
                snapshot = null
              }
              const idx = items.value.findIndex((s) => s.id === id)
              if (idx !== -1 && snapshot) await updateSnapshot(id, snapshot)
            } catch {}
          }
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
    createScoreboard,
    deleteScoreboard,
    updateSnapshot,
    verifyBoardPREEverywhere,
    ensureBoardPREPublished,
    ensureLoaded: () => loadOnce(),
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
  addLogEvent,
  }
})
