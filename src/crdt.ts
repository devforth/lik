/*
 * ScoreboardCRDT — operation-based CRDT for per-category user scores
 * - addScore(category, userPubKey, delta, eventUUID?, createdAtUTC?)
 * - hideCategory(category, eventUUID?, createdAtUTC?)
 * - getState(): { base, events }
 * - merge(events): adds external events (idempotent) and compacts
 *
 * Properties:
 * • Commutative ops: score increments (+1/-1) commute regardless of order
 * • Monotone visibility: starts at 1 (visible), hide() sets to 0 irreversibly
 * • Event log capped at 100 recent events; older ones are folded into base
 * • Deterministic ordering: (lamport, createdAtUTC, eventUUID)
 */

export type PubKey = string;

export type ScoreDelta = -1 | 1;

export interface AddScoreEvent {
  type: "addScore";
  category: string;
  userPubKey: PubKey;
  delta: ScoreDelta;
}

export interface HideCategoryEvent {
  type: "hideCategory";
  category: string;
}

export type EventPayload = AddScoreEvent | HideCategoryEvent;

export interface CRDTEvent {
  uuid: string; // globally unique id (idempotency key)
  actorId: string; // creator id (usually your pubkey)
  lamport: number; // lamport timestamp (causal tiebreaker)
  createdAtUTC: number; // client clock ms since epoch — advisory only
  payload: EventPayload;
}

export interface CategoryState {
  visible: 0 | 1;
  userScores: Record<PubKey, number>; // missing implies 0
}

export interface BaseState {
  categories: Record<string, CategoryState>;
  lastLamport: number; // max lamport folded into base
  lastCompactedEvent?: string; // uuid of the last event folded into base (advisory)
}

export interface Snapshot {
  base: BaseState;
  events: CRDTEvent[]; // at most 100 recent events to be applied on top of base
}

export class ScoreboardCRDT {
  private actorId: string;
  private base: BaseState;
  private log: CRDTEvent[] = [];
  private seen: Set<string> = new Set(); // idempotency set over ALL events (base+log)

  constructor(actorId: string, initial?: Partial<BaseState>) {
    this.actorId = actorId;
    this.base = {
      categories: {},
      lastLamport: 0,
      ...initial,
    };
  }

  /** Create and apply an addScore operation */
  addScore(
    category: string,
    userPubKey: PubKey,
    delta: ScoreDelta,
    eventUUID?: string,
    createdAtUTC?: number
  ): CRDTEvent | null {
    if (delta !== 1 && delta !== -1) throw new Error("delta must be ±1");
    const ev: CRDTEvent = {
      uuid: eventUUID ?? uuidv4(),
      actorId: this.actorId,
      lamport: this.nextLamport(),
      createdAtUTC: createdAtUTC ?? nowMs(),
      payload: { type: "addScore", category, userPubKey, delta },
    };
    return this.applyEvent(ev);
  }

  /** Create and apply a hideCategory operation */
  hideCategory(category: string, eventUUID?: string, createdAtUTC?: number): CRDTEvent | null {
    const ev: CRDTEvent = {
      uuid: eventUUID ?? uuidv4(),
      actorId: this.actorId,
      lamport: this.nextLamport(),
      createdAtUTC: createdAtUTC ?? nowMs(),
      payload: { type: "hideCategory", category },
    };
    return this.applyEvent(ev);
  }

  /** Merge external events (e.g., from peers). Returns count of newly applied events. */
  merge(events: CRDTEvent[]): number {
    let added = 0;
    for (const ev of events) {
      if (this.applyEvent(ev)) added++;
    }
    return added;
  }

  /** Current snapshot: base + up to 100 tail events */
  getState(): Snapshot {
    // return defensive copies
    return {
      base: deepClone(this.base),
      events: this.log.slice().sort(eventCmp),
    };
  }

  /** Lower-level apply that is commutative & idempotent */
  private applyEvent(ev: CRDTEvent): CRDTEvent | null {
    if (this.seen.has(ev.uuid)) return null; // idempotency
    // Track seen before mutation to make reentrancy safe
    this.seen.add(ev.uuid);

    // Apply payload to *derived state* (not into base directly). We keep the event in log
    // and fold into base during compaction.
    this.log.push(ev);

    // Keep log deterministically sorted for stability (also helps compaction choose oldest)
    this.log.sort(eventCmp);

    // Compact if needed
    if (this.log.length > 100) this.compact();

    return ev;
  }

  /** Fold oldest events (beyond 100 tail) into base, preserving CRDT properties */
  private compact(): void {
    if (this.log.length <= 100) return;
    const cutoff = this.log.length - 100;
    const toFold = this.log.slice(0, cutoff);
    this.log = this.log.slice(cutoff); // keep the 100 most recent

    // Apply folded events into base deterministically
    for (const ev of toFold) {
      this.applyIntoBase(ev);
      // advance base metadata
      if (ev.lamport > this.base.lastLamport) this.base.lastLamport = ev.lamport;
      this.base.lastCompactedEvent = ev.uuid;
    }
  }

  /** Deterministic application into base state (commutative and idempotent by construction) */
  private applyIntoBase(ev: CRDTEvent): void {
    const p = ev.payload;
    if (p.type === "addScore") {
      const cat = this.ensureCategory(p.category);
      const cur = cat.userScores[p.userPubKey] ?? 0;
      cat.userScores[p.userPubKey] = cur + p.delta;
    } else if (p.type === "hideCategory") {
      const cat = this.ensureCategory(p.category);
      // Monotone visibility: once 0, stays 0
      cat.visible = 0;
    }
  }

  /** Ensures category exists in BASE (visible by default). */
  private ensureCategory(category: string): CategoryState {
    const c = this.base.categories[category];
    if (c) return c;
    const created: CategoryState = { visible: 1, userScores: {} };
    this.base.categories[category] = created;
    return created;
  }

  /** Next Lamport timestamp for locally-created events */
  private nextLamport(): number {
    // Lamport is derived from max(lastLamport, max in log) + 1
    let maxL = this.base.lastLamport;
    for (const ev of this.log) if (ev.lamport > maxL) maxL = ev.lamport;
    return maxL + 1;
  }
}

// ---------- Helpers ----------

function eventCmp(a: CRDTEvent, b: CRDTEvent): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  if (a.createdAtUTC !== b.createdAtUTC) return a.createdAtUTC - b.createdAtUTC;
  return a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0;
}

function nowMs(): number {
  return Date.now();
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function uuidv4(): string {
  return crypto.randomUUID();
}
