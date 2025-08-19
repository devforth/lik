// Bridge between Nostr and CRDT: subscribe to PRE for board snapshots and merge locally.

import { SimplePool } from 'nostr-tools/pool'
import type { Filter } from 'nostr-tools'
import { RELAYS, sendPRE, KIND_PRE } from '@/nostr'
import { canonicalJSONStringify } from '@/lib/utils'
import shortId from '@/lib/utils'
import { nowUtc } from '@/time-sync'
import { useScoreboardsStore } from '@/stores/scoreboards'
import { ScoreboardCRDT, type EndingState, type LogEntry } from '@/crdt'
import { useUserStore } from '@/stores/user'

const pool = new SimplePool()
const active = new Map<string, { close: () => void }>()

function isEditor(boardId: string, me: string): boolean {
  const store = useScoreboardsStore()
  const sb = store.items.find((s) => s.id === boardId)
  if (!sb) return false
  if (String(sb.authorPubKey || '') === String(me)) return true
  const editors = Array.isArray(sb.editors) ? sb.editors : []
  return editors.includes(String(me))
}

// Append a log entry into a given EndingState.events immutably, cap at 100, sort by ts then id
function appendLogToState(prev: EndingState, entry: LogEntry): EndingState {
  const existing = Array.isArray(prev.events) ? prev.events as LogEntry[] : []
  const seen = new Set(existing.map((e) => String(e?.[0] ?? '')))
  const nextEvents = seen.has(String(entry[0])) ? existing : [...existing, entry]
  nextEvents.sort((a, b) => {
    const ta = Number(a[2] ?? 0), tb = Number(b[2] ?? 0)
    if (ta !== tb) return ta - tb
    return String(a[0] ?? '').localeCompare(String(b[0] ?? ''))
  })
  const trimmed = nextEvents.slice(-100)
  return { ...(prev as any), events: trimmed }
}

type ActionLog = '+1' | '-1' | 'add-cat' | 'prio' | 'unprio'
function appendActionLog(prev: EndingState, me: string, action: ActionLog, categoryId: string, participantId?: string | null): EndingState {
  const eid = shortId()
  const tsSec = Math.floor(nowUtc() / 1000)
  const entry: LogEntry = [eid, me, tsSec, String(categoryId), action, participantId == null ? null : String(participantId)]
  return appendLogToState(prev, entry)
}

async function publishSnapshot(boardId: string, state: EndingState) {
  try {
    const user = useUserStore()
    const p = await user.ensureUser()
    const tagD = `lik::crdt::${boardId}`
    // Encrypt state with board secret
    const store = useScoreboardsStore()
    const sb = store.items.find((s) => s.id === boardId)
    const secret = sb?.secret
    if (!secret) return // cannot publish without secret
    // Only owner or approved members are allowed to publish snapshots
    // this case should not be possible because UI shoudl disable buttons, but just in case, better throw to debug easier
    const me = p.pubkeyHex
    const editors = Array.isArray(sb?.editors) ? sb!.editors : []
    const isOwner = String(sb?.authorPubKey || '') === String(me)
    const isEditor = editors.includes(String(me))
    if (!isOwner && !isEditor) {
      throw new Error('Not authorized to publish snapshot')
    }

    const { aesEncryptToBase64 } = await import('@/lib/utils')
    const canon = canonicalJSONStringify(state)
    const enc = await aesEncryptToBase64(secret, canon)
    await sendPRE(p.pubkeyHex, p.privkeyHex, tagD, enc, state)
  } catch (e) {
    // non-fatal
  }
}

/**
 * Subscribe to PRE with #d "crdt::<boardId>" and authors filter of all pubkeys except own.
 * On events, parse snapshot JSON and merge into local board snapshot, persist in IDB via store.
 */
export function subscribeToBoardCRDT(boardId: string, pubkeys: string[]) {
  const tagD = `lik::crdt::${boardId}`
  const me = useUserStore().getPubKey()
  if (!me) {
    throw new Error('No pubkey available')
  }
  // Ensure we always constrain by authors; if excluding self empties the list,
  // prefer not to constrain by authors at all to avoid missing owner updates.
  if (!Array.isArray(pubkeys)) {
    throw new Error('Invalid pubkeys array')
  }
  if (!pubkeys.length) {
    throw new Error('Empty pubkeys array')
  }
  const authors = pubkeys.filter((p) => p !== me)
  // If we don't know any other authors yet, don't set an authors filter
  const key = `crdt:${boardId}`

  // Always close any existing subscription for this board before (re)subscribing
  if (active.has(key)) {
    try { active.get(key)!.close() } catch {}
    active.delete(key)
  }

  // If there are no other authors yet (only myself in editors), skip subscribing for now.
  // We'll subscribe later once another editor is approved and appears in the authors list.
  if (authors.length === 0) {
    console.info('[nostr] Skipping CRDT PRE subscription: no other authors yet', { boardId, editors: pubkeys })
    return () => {}
  }

  const baseFilter: any = { kinds: [KIND_PRE] as any, '#d': [tagD], authors }
  const filters: Filter[] = [baseFilter]
  console.info('✏️ [nostr] Subscribing to CRDT PRE', { boardId, authors, filters })
  const sub = pool.subscribeMany(RELAYS, filters as any, {
  onevent: async (evt: any) => {
    console.info('💧 [nostr] PRE event CRDT', { evt })
      try {
        const content = String(evt?.content || '')
        const store = useScoreboardsStore()
        const board = store.items.find((s) => s.id === boardId)
        if (!board) return
        const secret = board.secret
        if (!secret) return
        const { aesDecryptFromBase64 } = await import('@/lib/utils')
        const plain = await aesDecryptFromBase64(secret, content)
        const remote: EndingState = JSON.parse(plain)
        const crdt = new ScoreboardCRDT(me, board.snapshot || undefined)
        const next = crdt.merge(remote)
        // persist merged snapshot via store (IndexedDB)
        void store.updateSnapshot(boardId, next)
      } catch {}
    },
    oneose: () => {
      // keep open
    },
  })

  active.set(key, sub)
  return () => { try { sub.close() } finally { active.delete(key) } }
}

/**
 * Convenience method mirroring CRDT.addScore for specific board.
 */
export function addScore(boardId: string, categoryKey: string, participantId: string, delta: -1 | 1): EndingState | null {
  const store = useScoreboardsStore()
  const me = useUserStore().getPubKey()
  if (!me) throw new Error('No pubkey available')
  if (!isEditor(boardId, me)) {
    // again this should not even be possible but just to debug easier
    throw new Error('Not authorized to add score - insufficient permissions')
  }
  const board = store.items.find((s) => s.id === boardId)
  if (!board) return null
  const crdt = new ScoreboardCRDT(me, board.snapshot || undefined)
  let next = crdt.addScore(categoryKey, participantId, delta)
  // Append log inline to snapshot (avoid second publish path)
  next = appendActionLog(next, me, delta === 1 ? '+1' : '-1', String(categoryKey), String(participantId))
  void store.updateSnapshot(boardId, next)
  // Publish PRE snapshot for others to merge
  void publishSnapshot(boardId, next)
  return next
}

/** Remove a participant from the CRDT snapshot (erase their counters across categories). */
export function removeParticipantData(boardId: string, participantId: string): EndingState | null {
  const store = useScoreboardsStore()
  const me = useUserStore().getPubKey()
  if (!me) throw new Error('No pubkey available')
  if (!isEditor(boardId, me)) {
    throw new Error('Not authorized to remove participant - insufficient permissions')
  }
  const board = store.items.find((s) => s.id === boardId)
  if (!board) return null
  const crdt = new ScoreboardCRDT(me, board.snapshot || undefined)
  const next = crdt.removeParticipant(participantId)
  void store.updateSnapshot(boardId, next)
  void publishSnapshot(boardId, next)
  return next
}

/**
 * Create a new category (ensured) and set its name, then merge and persist.
 * Note: ensureCategory is internal to CRDT and is triggered by renameCategory.
 */
export function addCategory(boardId: string, id: string, name: string): EndingState | null {
  const store = useScoreboardsStore()
  const me = useUserStore().getPubKey()
  if (!me) throw new Error('No pubkey available')
  if (!isEditor(boardId, me)) {
    throw new Error('Not authorized to add category - insufficient permissions')
  }
  const board = store.items.find((s) => s.id === boardId)
  if (!board) return null

  // Determine the current max order among visible, non-shadow categories
  const cats = ((board.snapshot as any)?.categories || {}) as Record<string, any>
  const maxOrder = Object.entries(cats)
    .filter(([key, val]) => !String(key).endsWith('::prio') && (val?.vis ?? 1) === 1)
    .reduce((acc, [, val]) => Math.max(acc, Number(val?.order ?? 0)), 0)
  const nextOrder = (Number.isFinite(maxOrder) ? maxOrder : 0) + 1

  // Build a minimal delta state by performing rename (which ensures the category) and setting its order to top
  const deltaCrdt = new ScoreboardCRDT(me)
  const afterRename = deltaCrdt.renameCategory(id, name)
  const afterOrder = new ScoreboardCRDT(me, afterRename).setOrder(id, nextOrder)
  // Also ensure a priority shadow category for this category, unnamed and hidden in UI by key suffix
  const prioKey = `${id}::prio`
  const afterPrio = new ScoreboardCRDT(me, afterOrder).renameCategory(prioKey, '')

  // Merge delta into current snapshot
  const baseCrdt = new ScoreboardCRDT(me, board.snapshot || undefined)
  const merged = baseCrdt.merge(afterPrio)

  // Append log inline (add-cat)
  const withLog = appendActionLog(merged, me, 'add-cat', String(id), null)
  void store.updateSnapshot(boardId, withLog)
  // Publish PRE snapshot for others to merge
  void publishSnapshot(boardId, withLog)
  return withLog
}

/**
 * Set category order (number, higher shows on top). Persist and publish snapshot.
 */
export function setOrder(boardId: string, categoryKey: string, order: number): EndingState | null {
  const store = useScoreboardsStore()
  const me = useUserStore().getPubKey()
  if (!me) throw new Error('No pubkey available')
  if (!isEditor(boardId, me)) {
    throw new Error('Not authorized to set order - insufficient permissions')
  }
  const board = store.items.find((s) => s.id === boardId)
  if (!board) return null

  const delta = new ScoreboardCRDT(me)
  const after = delta.setOrder(categoryKey, Number(order))
  const base = new ScoreboardCRDT(me, board.snapshot || undefined)
  const merged = base.merge(after)
  void store.updateSnapshot(boardId, merged)
  void publishSnapshot(boardId, merged)
  return merged
}

/**
 * Rename existing category and persist + publish changes.
 * Uses CRDT.renameCategory to produce a delta, merges it into current snapshot,
 * then stores and publishes the new snapshot.
 */
export function editCat(boardId: string, id: string, name: string): EndingState | null {
  const store = useScoreboardsStore()
  const me = useUserStore().getPubKey()
  if (!me) throw new Error('No pubkey available')
  if (!isEditor(boardId, me)) {
    throw new Error('Not authorized to edit category - insufficient permissions')
  }
  const board = store.items.find((s) => s.id === boardId)
  if (!board) return null

  // Create delta with just the rename, which also ensures the category exists if missing
  const deltaCrdt = new ScoreboardCRDT(me)
  const afterRename = deltaCrdt.renameCategory(id, name)

  // Merge into current state
  const baseCrdt = new ScoreboardCRDT(me, board.snapshot || undefined)
  const merged = baseCrdt.merge(afterRename)

  void store.updateSnapshot(boardId, merged)
  void publishSnapshot(boardId, merged)
  return merged
}

/**
 * Set priority for a participant within a category using the category's shadow key `${categoryKey}::prio`.
 * Implements single-selection priority by adding +1 for the chosen participant and -1 for all others.
 * Uses PN-counter mechanics without modifying the CRDT structure.
 */
export function setPriority(boardId: string, categoryKey: string, participantId: string): EndingState | null {
  const store = useScoreboardsStore()
  const me = useUserStore().getPubKey()
  if (!me) throw new Error('No pubkey available')
  if (!isEditor(boardId, me)) {
    throw new Error('Not authorized to set priority - insufficient permissions')
  }
  const board = store.items.find((s) => s.id === boardId)
  if (!board) return null
  const prioKey = `${categoryKey}::prio`

  // Build a delta with priority increments/decrements
  const delta = new ScoreboardCRDT(me)
  const parts = Array.isArray(board.participants) ? board.participants : []
  const cur = (board.snapshot as any)?.categories?.[prioKey]
  const getScore = (pid: string) => {
    const P = Number((cur?.state?.P || {})[pid] || 0)
    const N = Number((cur?.state?.N || {})[pid] || 0)
    return P - N
  }

  for (const p of parts) {
    const pid = p?.id
    if (!pid) continue
    try {
      const Pcur = Number((cur?.state?.P || {})[pid] || 0)
      const Ncur = Number((cur?.state?.N || {})[pid] || 0)
      const s = Pcur - Ncur
      if (pid === participantId) {
        // Target exactly +1 using only increases. If s < 1 => raise P; if s > 1 => raise N
        if (s < 1) {
          const incP = 1 - s // amount to add to P
          const targetP = Pcur + incP
          for (let i = 0; i < targetP; i++) delta.addScore(prioKey, pid, 1)
        } else if (s > 1) {
          const incN = s - 1 // amount to add to N
          const targetN = Ncur + incN
          for (let i = 0; i < targetN; i++) delta.addScore(prioKey, pid, -1)
        }
      } else {
        // Target 0 for others: raise the smaller side to match the larger side
        if (s > 0) {
          const incN = s
          const targetN = Ncur + incN
          for (let i = 0; i < targetN; i++) delta.addScore(prioKey, pid, -1)
        } else if (s < 0) {
          const incP = -s
          const targetP = Pcur + incP
          for (let i = 0; i < targetP; i++) delta.addScore(prioKey, pid, 1)
        }
      }
    } catch { /* ignore per-participant errors */ }
  }

  const base = new ScoreboardCRDT(me, board.snapshot || undefined)
  let merged = base.merge(delta.getState())
  // Append log inline (prio)
  merged = appendActionLog(merged, me, 'prio', String(categoryKey), String(participantId))
  void store.updateSnapshot(boardId, merged)
  void publishSnapshot(boardId, merged)
  return merged
}

/**
 * Clear priority for a participant within a category: normalize their `${categoryKey}::prio` counter to 0.
 */
export function clearPriority(boardId: string, categoryKey: string, participantId: string): EndingState | null {
  const store = useScoreboardsStore()
  const me = useUserStore().getPubKey()
  if (!me) throw new Error('No pubkey available')
  if (!isEditor(boardId, me)) {
    throw new Error('Not authorized to clear priority - insufficient permissions')
  }
  const board = store.items.find((s) => s.id === boardId)
  if (!board) return null
  const prioKey = `${categoryKey}::prio`

  const cur = (board.snapshot as any)?.categories?.[prioKey]
  const P = Number((cur?.state?.P || {})[participantId] || 0)
  const N = Number((cur?.state?.N || {})[participantId] || 0)
  const s = P - N

  const delta = new ScoreboardCRDT(me)
  if (s > 0) {
    const targetN = N + s
    for (let i = 0; i < targetN; i++) delta.addScore(prioKey, participantId, -1)
  } else if (s < 0) {
    const targetP = P + (-s)
    for (let i = 0; i < targetP; i++) delta.addScore(prioKey, participantId, 1)
  }

  const base = new ScoreboardCRDT(me, board.snapshot || undefined)
  let merged = base.merge(delta.getState())
  // Append log inline (unprio)
  merged = appendActionLog(merged, me, 'unprio', String(categoryKey), String(participantId))
  void store.updateSnapshot(boardId, merged)
  void publishSnapshot(boardId, merged)
  return merged
}

/**
 * Append a log entry into CRDT snapshot.events and publish. Used so editors can propagate activity logs via CRDT channel.
 */
export function appendLogEvent(boardId: string, entry: LogEntry): EndingState | null {
  const store = useScoreboardsStore()
  const me = useUserStore().getPubKey()
  if (!me) throw new Error('No pubkey available')
  if (!isEditor(boardId, me)) {
    throw new Error('Not authorized to append log - insufficient permissions')
  }
  const board = store.items.find((s) => s.id === boardId)
  if (!board) return null
  const base = new ScoreboardCRDT(me, board.snapshot || undefined)
  const cur = base.getState()
  const existing = Array.isArray(cur.events) ? cur.events : []
  const id0 = String(entry?.[0] || '')
  const seen = new Set(existing.map((e) => String(e?.[0] || '')))
  const nextEvents = seen.has(id0) ? existing : [...existing, entry]
  // cap 100 by time then id
  nextEvents.sort((a, b) => {
    const ta = Number(a[2] || 0), tb = Number(b[2] || 0)
    if (ta !== tb) return ta - tb
    return String(a[0]||'').localeCompare(String(b[0]||''))
  })
  const trimmed = nextEvents.slice(-100)
  const next: EndingState = { ...(cur as any), events: trimmed }
  void store.updateSnapshot(boardId, next)
  // Do NOT publish here to avoid double-send; actions will publish combined snapshot
  return next
}

/**
 * Republish the latest known CRDT snapshot for a board as-is.
 * Returns true if a publish was attempted, false if no snapshot was available.
 */
export async function republishCRDT(boardId: string): Promise<boolean> {
  try {
    const store = useScoreboardsStore()
    const sb = store.items.find((s) => s.id === boardId)
    const snap = sb?.snapshot as EndingState | undefined
    if (!sb || !snap) return false
    await publishSnapshot(boardId, snap)
    return true
  } catch {
    return false
  }
}

export default { subscribeToBoardCRDT, addScore, addCategory, editCat, removeParticipantData, setPriority, clearPriority, appendLogEvent, setOrder, republishCRDT }
