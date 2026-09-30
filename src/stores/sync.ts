// Sync status per board: has the local CRDT snapshot reached the relays, and how fresh is remote data.
// "Sent" means read back from relays, not just acknowledged: some relays answer OK and store nothing.

import { ref, reactive } from 'vue'
import { defineStore } from 'pinia'
import { RELAYS, fetchPREPerRelay, reconnectRelays, type Published } from '@/nostr'
import { ScoreboardCRDT, type EndingState } from '@/crdt'
import { republishCRDT } from '@/nostrToCRDT'
import { useScoreboardsStore, type Scoreboard } from '@/stores/scoreboards'
import { useUserStore } from '@/stores/user'

export type RelayState = 'sending' | 'latest' | 'older' | 'failed'
export type RelayStatus = { state: RelayState; reason?: string }
export type SyncState = 'synced' | 'sending' | 'pending' | 'offline' | 'checking'

export type BoardSyncStatus = {
  state: SyncState
  // changes only on this phone; null when unknown (nothing confirmed yet on this device)
  count: number | null
  // `${categoryKey}|${participantId}` of cells whose score or star is not on relays yet
  cells: Set<string>
  relays: Record<string, RelayStatus>
  lastLocalAt: number
  lastReceivedAt: number
  lastReceivedFrom: string
  canEdit: boolean
}

type BoardSync = {
  // What relays are known to hold: my confirmed snapshots merged with snapshots received from others.
  // null until the first confirmation on this device
  baseline: EndingState | null
  relays: Record<string, RelayStatus>
  // the latest read-back could not confirm the snapshot on enough relays
  unconfirmed: boolean
  inflight: number
  latestEventId: string
  pendingSince: number // ms, first change not confirmed yet; 0 when none
  lastLocalAt: number // ms
  lastAttemptAt: number // ms
  lastReceivedAt: number // sec, created_at of the newest snapshot from another editor
  lastReceivedFrom: string
  checking: boolean
}

const CONFIRM_RELAYS = Math.min(2, RELAYS.length)
const STALE_MS = 10_000
const RETRY_MS = 15_000
const CHECK_TIMEOUT_MS = 8_000
// Generous for 2G: a relay that doesn't answer in time counts as not having the snapshot
const READBACK_TIMEOUT_MS = 10_000
const STORAGE_PREFIX = 'lik:sync:'

const startedAt = Date.now()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function hasContent(snap: EndingState | undefined): boolean {
  return !!snap && Object.keys(snap.categories || {}).length > 0
}

/** Changes present in `local` but not in `base`: category edits plus score/star cells of current participants. */
function pendingDiff(local: EndingState | undefined, base: EndingState, participantIds: string[]) {
  const cells = new Set<string>()
  let categories = 0
  const lc = local?.categories || {}
  const bc = base.categories || {}
  for (const key of new Set([...Object.keys(lc), ...Object.keys(bc)])) {
    const a = lc[key]
    const b = bc[key]
    const isPrio = key.endsWith('::prio')
    const cellKey = isPrio ? key.slice(0, -'::prio'.length) : key
    if (!isPrio) {
      // Deleted on both sides: nothing to show
      if ((a?.vis ?? 0) === 0 && (b?.vis ?? 0) === 0) continue
      if (!a || !b || a.name !== b.name || a.vis !== b.vis || a.order !== b.order) categories++
      // Deleted locally: its counters don't matter
      if (a?.vis === 0) continue
    }
    for (const pid of participantIds) {
      const sameP = Number(a?.state?.P?.[pid] || 0) === Number(b?.state?.P?.[pid] || 0)
      const sameN = Number(a?.state?.N?.[pid] || 0) === Number(b?.state?.N?.[pid] || 0)
      if (!sameP || !sameN) cells.add(`${cellKey}|${pid}`)
    }
  }
  return { count: categories + cells.size, cells }
}

function canEdit(sb: Scoreboard, me: string): boolean {
  return !!me && (sb.authorPubKey === me || (sb.editors || []).includes(me))
}

export const useSyncStore = defineStore('sync', () => {
  const boards = reactive<Record<string, BoardSync>>({})
  const online = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
  // Ticks so time-based states (sending -> not sent) re-evaluate
  const now = ref(Date.now())
  const checkTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const eoseCounts = new Map<string, number>()

  function entry(boardId: string): BoardSync {
    let s = boards[boardId]
    if (s) return s
    let saved: Partial<BoardSync> = {}
    try { saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + boardId) || '{}') } catch {}
    boards[boardId] = {
      baseline: saved.baseline ?? null,
      relays: {},
      unconfirmed: !!saved.unconfirmed,
      inflight: 0,
      latestEventId: '',
      pendingSince: Number(saved.pendingSince || 0),
      lastLocalAt: Number(saved.lastLocalAt || 0),
      lastAttemptAt: 0,
      lastReceivedAt: Number(saved.lastReceivedAt || 0),
      lastReceivedFrom: String(saved.lastReceivedFrom || ''),
      checking: false,
    }
    return boards[boardId]
  }

  function persist(boardId: string) {
    const s = boards[boardId]
    if (!s) return
    const { baseline, unconfirmed, pendingSince, lastLocalAt, lastReceivedAt, lastReceivedFrom } = s
    try {
      localStorage.setItem(STORAGE_PREFIX + boardId, JSON.stringify({ baseline, unconfirmed, pendingSince, lastLocalAt, lastReceivedAt, lastReceivedFrom }))
    } catch {}
  }

  function forget(boardId: string) {
    delete boards[boardId]
    try { localStorage.removeItem(STORAGE_PREFIX + boardId) } catch {}
  }

  function statusFor(boardId: string): BoardSyncStatus | null {
    const sb = useScoreboardsStore().items.find((x) => x.id === boardId)
    if (!sb) return null
    const s = entry(boardId)
    const t = now.value
    const editor = canEdit(sb, useUserStore().getPubKey() || '')
    let count: number | null = 0
    let cells = new Set<string>()
    if (editor) {
      if (s.baseline) {
        const participantIds = (sb.participants || []).map((p) => p.id)
        ;({ count, cells } = pendingDiff(sb.snapshot, s.baseline, participantIds))
      } else if (hasContent(sb.snapshot)) {
        count = null
      }
    }
    const pending = editor && (count !== 0 || s.unconfirmed)
    let state: SyncState = 'synced'
    if (pending) {
      if (!online.value) state = 'offline'
      else state = t - (s.pendingSince || startedAt) < STALE_MS ? 'sending' : 'pending'
    } else if (s.checking) {
      state = 'checking'
    }
    return {
      state,
      count: pending && count === 0 ? null : count,
      cells,
      relays: s.relays,
      lastLocalAt: s.lastLocalAt,
      lastReceivedAt: s.lastReceivedAt,
      lastReceivedFrom: s.lastReceivedFrom,
      canEdit: editor,
    }
  }

  // ---------- outgoing ----------

  function noteLocalChange(boardId: string) {
    const s = entry(boardId)
    s.lastLocalAt = Date.now()
    if (!s.pendingSince) s.pendingSince = s.lastLocalAt
    persist(boardId)
  }

  function notePublishStart(boardId: string) {
    entry(boardId).inflight++
  }

  function notePublishEnd(boardId: string) {
    const s = entry(boardId)
    s.inflight = Math.max(0, s.inflight - 1)
  }

  /** Wait for relay answers, read the snapshot back from each relay and move the baseline when enough have it. */
  async function trackPublish(boardId: string, published: Published | null) {
    if (!published) return
    const s = entry(boardId)
    const eventId = String(published.event.id)
    // Debounced sends resolve every caller with the same publish
    if (s.latestEventId === eventId) return
    s.latestEventId = eventId
    s.lastAttemptAt = Date.now()
    s.inflight++
    try {
      const results = await published.results
      if (s.latestEventId !== eventId) return // a newer publish took over
      for (const r of results) s.relays[r.relay] = { state: 'sending' }
      // Let relays index the event before asking for it
      await sleep(500)
      const okRelays = results.filter((r) => r.ok).map((r) => r.relay)
      const dTag = (published.event.tags || []).find((t: string[]) => t[0] === 'd')?.[1] || ''
      const served = okRelays.length ? await fetchPREPerRelay(dTag, [published.event.pubkey], okRelays, READBACK_TIMEOUT_MS) : {}
      if (s.latestEventId !== eventId) return // a newer publish took over
      let confirmed = 0
      for (const r of results) {
        const got = served[r.relay]
        if (!r.ok) s.relays[r.relay] = { state: 'failed', reason: r.reason }
        else if (got === undefined) s.relays[r.relay] = { state: 'failed', reason: 'no response' }
        else if (got && (got.id === eventId || Number(got.created_at) > Number(published.event.created_at))) {
          s.relays[r.relay] = { state: 'latest' }
          confirmed++
        } else s.relays[r.relay] = { state: 'older' }
      }
      if (confirmed >= CONFIRM_RELAYS) {
        const sb = useScoreboardsStore().items.find((x) => x.id === boardId)
        if (!sb?.secret) return
        const { aesDecryptFromBase64 } = await import('@/lib/utils')
        const sent: EndingState = JSON.parse(await aesDecryptFromBase64(sb.secret, String(published.event.content)))
        const me = useUserStore().getPubKey() || ''
        s.baseline = s.baseline ? new ScoreboardCRDT(me, s.baseline).merge(sent) : sent
        s.unconfirmed = false
        const participantIds = (sb.participants || []).map((p) => p.id)
        // Changes made while this publish was in flight are still waiting
        s.pendingSince = pendingDiff(sb.snapshot, s.baseline, participantIds).count ? s.lastLocalAt || Date.now() : 0
      } else {
        s.unconfirmed = true
        if (!s.pendingSince) s.pendingSince = Date.now()
      }
      persist(boardId)
    } catch (e) {
      console.warn('[sync] trackPublish failed', e)
    } finally {
      s.inflight = Math.max(0, s.inflight - 1)
    }
  }

  /** Republish boards whose changes are not confirmed yet. `force` skips the wait between attempts. */
  function retryPending(force = false) {
    if (!online.value) return
    const t = Date.now()
    for (const sb of useScoreboardsStore().items) {
      const st = statusFor(sb.id)
      if (!st || !st.canEdit || (st.state !== 'pending' && !force) || (force && st.count === 0 && !entry(sb.id).unconfirmed)) continue
      const s = entry(sb.id)
      // Forced (back online): attempts started while offline are still timing out, publish over them
      if (!force && (s.inflight > 0 || t - s.lastAttemptAt < RETRY_MS)) continue
      s.lastAttemptAt = t
      void republishCRDT(sb.id)
    }
  }

  /** "Send again": fresh connections, then republish this board right away. */
  function sendAgain(boardId: string) {
    reconnectRelays()
    entry(boardId).lastAttemptAt = Date.now()
    void republishCRDT(boardId)
  }

  // ---------- incoming ----------

  function startChecking(boardId: string) {
    const s = entry(boardId)
    s.checking = true
    eoseCounts.set(boardId, 0)
    clearTimeout(checkTimers.get(boardId))
    checkTimers.set(boardId, setTimeout(() => stopChecking(boardId), CHECK_TIMEOUT_MS))
  }

  function stopChecking(boardId: string) {
    clearTimeout(checkTimers.get(boardId))
    checkTimers.delete(boardId)
    if (boards[boardId]) boards[boardId].checking = false
  }

  /** A relay finished sending stored snapshots (or failed); two answers are enough to call it fresh. */
  function noteEose(boardId: string) {
    const n = (eoseCounts.get(boardId) || 0) + 1
    eoseCounts.set(boardId, n)
    if (n >= CONFIRM_RELAYS) stopChecking(boardId)
  }

  /** A snapshot from another editor came from relays, so relays hold everything in it. */
  function noteReceived(boardId: string, remote: EndingState, author: string, createdAt: number) {
    const s = entry(boardId)
    if (createdAt > s.lastReceivedAt) {
      s.lastReceivedAt = createdAt
      s.lastReceivedFrom = author
    }
    if (s.baseline) s.baseline = new ScoreboardCRDT(useUserStore().getPubKey() || '', s.baseline).merge(remote)
    persist(boardId)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { online.value = true; retryPending(true) })
    window.addEventListener('offline', () => { online.value = false })
    setInterval(() => {
      now.value = Date.now()
      retryPending()
    }, 5_000)
  }

  return {
    online,
    statusFor,
    noteLocalChange,
    notePublishStart,
    notePublishEnd,
    trackPublish,
    sendAgain,
    startChecking,
    stopChecking,
    noteEose,
    noteReceived,
    forget,
  }
})
