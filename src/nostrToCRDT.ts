// Bridge between Nostr and CRDT: subscribe to PRE for board snapshots and merge locally.

import { SimplePool } from 'nostr-tools/pool'
import type { Filter } from 'nostr-tools'
import { RELAYS, sendPRE } from '@/nostr'
import { useScoreboardsStore } from '@/stores/scoreboards'
import { ScoreboardCRDT, type EndingState } from '@/crdt'
import { useUserStore } from '@/stores/user'

const pool = new SimplePool()
const active = new Map<string, { close: () => void }>()
async function publishSnapshot(boardId: string, state: EndingState) {
  try {
    const user = useUserStore()
    const p = await user.ensureUser()
    const tagD = `lik::crdt::${boardId}`
    await sendPRE(p.pubkeyHex, p.privkeyHex, tagD, state)
  } catch (e) {
    // non-fatal
  }
}

/**
 * Subscribe to PRE with #d "crdt::<boardId>" and authors filter of all pubkeys except own.
 * On events, parse snapshot JSON and merge into local board snapshot, persist in IDB via store.
 */
export function subscribeToBoard(boardId: string, pubkeys: string[]) {
  const tagD = `lik::crdt::${boardId}`
  const me = useUserStore().getPubKey()
  if (!me) throw new Error('No pubkey available')
  const authors = (Array.isArray(pubkeys) ? pubkeys : []).map(String).filter((p) => p && p !== me)
  const key = `crdt:${boardId}`

  if (active.has(key)) {
    try { active.get(key)!.close() } catch {}
    active.delete(key)
  }

  const filters: Filter[] = [{ '#d': [tagD] } as any]
  if (authors.length) (filters[0] as any).authors = authors

  const sub = pool.subscribeMany(RELAYS, filters as any, {
    onevent: (evt: any) => {
      try {
        const content = String(evt?.content || '{}')
        const remote: EndingState = JSON.parse(content)
        const store = useScoreboardsStore()
        const board = store.items.find((s) => s.id === boardId)
        if (!board) return
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
  const board = store.items.find((s) => s.id === boardId)
  if (!board) return null
  const crdt = new ScoreboardCRDT(me, board.snapshot || undefined)
  const next = crdt.addScore(categoryKey, participantId, delta)
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
  const board = store.items.find((s) => s.id === boardId)
  if (!board) return null

  // Build a minimal delta state by performing rename (which ensures the category)
  const deltaCrdt = new ScoreboardCRDT(me)
  const afterRename = deltaCrdt.renameCategory(id, name)

  // Merge delta into current snapshot
  const baseCrdt = new ScoreboardCRDT(me, board.snapshot || undefined)
  const merged = baseCrdt.merge(afterRename)

  // Persist via store method
  void store.updateSnapshot(boardId, merged)
  // Publish PRE snapshot for others to merge
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

export default { subscribeToBoard, addScore, addCategory, editCat, removeParticipantData }
