/*
 * ScoreboardCRDT — PN-counter CRDT per-category, per-participant with LWW for name/vis
 * - addScore(categoryKey, participantId, delta)
 * - renameCategory(categoryKey, newName)
 * - setVisibility(categoryKey, vis)
 * - getState(): EndingState
 * - merge(otherState): returns merged EndingState
 *
 * Category structure:
 * { id: shortId(), name: string, state: { P: { pk: n }, N: { pk: n } }, vis: 1|0, order: number, nameTs: number, visTs: number, orderTs: number }
 * Merge rule:
 * - For P/N maps: pointwise max per participant id
 * - For name/vis/order: last-writer-wins by timestamp (createdAtUTC); ties resolved by lex id
 */

import { nowUtc } from '@/time-sync'
import shortId from '@/lib/utils'

export type ParticipantId = string
export type ScoreDelta = -1 | 1

export type PNMap = Record<ParticipantId, number>

export interface CategoryPN {
  id: string
  name: string
  state: { P: PNMap; N: PNMap }
  vis: 0 | 1
  order: number
  nameTs: number // last update ms for name
  visTs: number // last update ms for vis
  orderTs: number // last update ms for order
}

export interface EndingState {
  categories: Record<string, CategoryPN> // key is category key (string)
}

export class ScoreboardCRDT {
  private actorId: string
  private state: EndingState

  constructor(actorId: string, initial?: Partial<EndingState>) {
    this.actorId = String(actorId)
    this.state = { categories: {}, ...(initial || {}) }
  }

  getState(): EndingState {
    return deepClone(this.state)
  }

  /** Ensure category exists (does not auto-create name; default empty). */
  private ensureCategory(key: string): CategoryPN {
    let c = this.state.categories[key]
    if (!c) {
      c = {
        id: shortId(),
        name: '',
        state: { P: {}, N: {} },
        vis: 1,
        order: 0,
        nameTs: 0,
        visTs: 0,
        orderTs: 0,
      }
      this.state.categories[key] = c
    }
    return c
  }

  /** Add +1/-1 for participant in category using PN-counter semantics. */
  addScore(categoryKey: string, participantId: ParticipantId, delta: ScoreDelta): EndingState {
    if (delta !== 1 && delta !== -1) throw new Error('delta must be ±1')
    const c = this.ensureCategory(categoryKey)
    const map = delta === 1 ? c.state.P : c.state.N
    const cur = Number(map[participantId] || 0)
    map[participantId] = cur + 1
    return this.getState()
  }

  /** Remove all counters for a participant across all categories (irreversible). */
  removeParticipant(participantId: ParticipantId): EndingState {
    for (const c of Object.values(this.state.categories)) {
      if (!c || !c.state) continue
      if (participantId in c.state.P) delete c.state.P[participantId]
      if (participantId in c.state.N) delete c.state.N[participantId]
    }
    return this.getState()
  }

  /** Rename category with LWW by nowUtc. */
  renameCategory(categoryKey: string, newName: string): EndingState {
    const c = this.ensureCategory(categoryKey)
    const ts = nowUtc()
    if (ts > c.nameTs) {
      c.name = String(newName || '')
      c.nameTs = ts
    }
    return this.getState()
  }

  /** Set visibility with LWW by nowUtc (1/0). */
  setVisibility(categoryKey: string, vis: 0 | 1): EndingState {
    const c = this.ensureCategory(categoryKey)
    const ts = nowUtc()
    if (ts > c.visTs) {
      c.vis = vis
      c.visTs = ts
    }
    return this.getState()
  }

  /** Set ordering index with LWW by nowUtc (number). */
  setOrder(categoryKey: string, order: number): EndingState {
    const c = this.ensureCategory(categoryKey)
    const ts = nowUtc()
    if (ts > c.orderTs) {
      c.order = Number.isFinite(order as any) ? Number(order) : 0
      c.orderTs = ts
    }
    return this.getState()
  }

  /** Merge another EndingState into this, returning ending state. */
  merge(other: EndingState): EndingState {
    if (!other || typeof other !== 'object') return this.getState()
    for (const [key, oc] of Object.entries(other.categories || {})) {
      const c = this.ensureCategory(key)
      // id: keep existing if present, else take other
      if (!c.id) c.id = oc.id || shortId()
      // P and N: pointwise max
      for (const [pk, n] of Object.entries(oc.state?.P || {})) {
        const a = c.state.P[pk] || 0
        if (n > a) c.state.P[pk] = n
      }
      for (const [pk, n] of Object.entries(oc.state?.N || {})) {
        const a = c.state.N[pk] || 0
        if (n > a) c.state.N[pk] = n
      }
      // vis LWW
      const oVisTs = Number(oc.visTs || 0)
      if (oVisTs > c.visTs || (oVisTs === c.visTs && (oc.id || key) < (c.id || key))) {
        c.vis = oc.vis as any === 1 ? 1 : 0
        c.visTs = oVisTs
      }
      // name LWW
      const oNameTs = Number(oc.nameTs || 0)
      if (oNameTs > c.nameTs || (oNameTs === c.nameTs && (oc.id || key) < (c.id || key))) {
        c.name = String(oc.name || '')
        c.nameTs = oNameTs
      }
      // order LWW
      const oOrderTs = Number(oc.orderTs || 0)
      if (oOrderTs > c.orderTs || (oOrderTs === c.orderTs && (oc.id || key) < (c.id || key))) {
        c.order = Number(oc.order ?? 0)
        c.orderTs = oOrderTs
      }
    }
    return this.getState()
  }
}

// ---------- Helpers ----------
function deepClone<T>(x: T): T { return JSON.parse(JSON.stringify(x)) }
