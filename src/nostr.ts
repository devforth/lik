// Lightweight Nostr client glue for the app
// - connects to a few popular public relays
// - exposes nostrSubscribeTag(tag, onEvent?) => unsubscribe
// - exposes send(pubkey, privkey, kind, content, tags?) => Promise<void>

import { SimplePool, type SubCloser } from 'nostr-tools/pool'
import type { EventTemplate, Filter } from 'nostr-tools'
import { finalizeEvent } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import { canonicalJSONStringify, sha256Hex, computeMetadataHash } from '@/lib/utils'

export type NostrEvent = any

// Free public relays that accept kind 0/1/30078 from fresh keys, survive bursts of publishes
// and return the latest event on a fresh connection (probed 2026-09-30).
// Not used: relay.damus.io (answers OK but stores nothing for new keys, bans on bursts),
// nostr.oxtr.dev (rate-limits bursts), offchain.pub / nostr.bitcoiner.social (web-of-trust only).
export const RELAYS = [
  'wss://relay.nostr.net',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://nostr.sathoarder.com',
  'wss://nostr-01.yakihonne.com',
]

// Shared pool instance for the whole app; ping detects sockets that died without a close event
const pool = new SimplePool({ enablePing: true })

// Keep local refs to open subscriptions by key for optional housekeeping
const activeSubs = new Map<string, { close: () => void }>()

// Per-relay pieces of live subscriptions, so reconnectRelays() can reopen them right away
const liveRelaySubs = new Set<{ reopen: () => void }>()

/**
 * Long-lived subscription that survives dropped connections: every relay gets its own
 * subscription which is reopened (with backoff) whenever that relay closes it.
 * @returns unsubscribe function
 */
export function subscribeLive(
  filter: Filter,
  onEvent: (event: NostrEvent, relay: string) => void,
  opts: { relays?: string[]; onEose?: (relay: string) => void } = {},
) {
  const relays = opts.relays ?? RELAYS
  let stopped = false
  const parts = relays.map((relay) => {
    let sub: SubCloser | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let openedAt = 0
    const open = () => {
      timer = null
      if (stopped) return
      openedAt = Date.now()
      sub = pool.subscribeMany([relay], filter, {
        onevent: (evt) => onEvent(evt, relay),
        oneose: () => opts.onEose?.(relay),
        onclose: (reasons) => {
          if (stopped) return
          // A subscription that lived a while was healthy; start backoff from scratch
          if (Date.now() - openedAt > 30_000) attempt = 0
          const delay = Math.min(60_000, 500 * 2 ** attempt++)
          console.info(`[nostr] ${relay} closed subscription (${reasons.map((r) => r.reason).join(', ')}), reopening in ${delay}ms`)
          timer = setTimeout(open, delay)
        },
      })
    }
    const part = {
      reopen: () => {
        if (stopped) return
        if (timer) clearTimeout(timer)
        attempt = 0
        open()
      },
      close: () => {
        if (timer) clearTimeout(timer)
        liveRelaySubs.delete(part)
        try { sub?.close() } catch { /* noop */ }
      },
    }
    liveRelaySubs.add(part)
    open()
    return part
  })
  return () => {
    stopped = true
    for (const p of parts) p.close()
  }
}

/** Drop every relay socket and reopen live subscriptions on fresh connections. */
export function reconnectRelays() {
  console.info('[nostr] reconnecting relays')
  // Closing sockets fires onclose of live subscriptions synchronously; reopen() then cancels their backoff timers
  pool.destroy()
  for (const p of liveRelaySubs) p.reopen()
}

// Android WebView keeps sockets that died while the app was in background (no close event is fired),
// so after a long pause start over with fresh connections instead of waiting for ping timeouts.
const STALE_AFTER_HIDDEN_MS = 15_000
let hiddenAt = 0
function onAppHidden() {
  if (!hiddenAt) hiddenAt = Date.now()
}
function onAppVisible() {
  if (hiddenAt && Date.now() - hiddenAt > STALE_AFTER_HIDDEN_MS) reconnectRelays()
  hiddenAt = 0
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onAppHidden()
    else onAppVisible()
  })
  // Capacitor dispatches these on Android activity pause/resume
  document.addEventListener('pause', onAppHidden)
  document.addEventListener('resume', onAppVisible)
  // Network changed (e.g. Wi-Fi -> mobile): old sockets are dead
  window.addEventListener('online', reconnectRelays)
}

// Debounce configuration for publish calls
export const RELAY_DEBOUNCE_SEC: number = Number((import.meta as any)?.env?.VITE_RELAY_DEBOUNCE_SEC ?? 0.5)
const RELAY_DEBOUNCE_MS = Math.max(0, Math.floor(RELAY_DEBOUNCE_SEC * 1000))

type SendArgs = {
  pubkeyHex: string
  privkeyHex: string
  kind: number
  content: string
  tags: string[][]
  originalContentForDbg: any
  relays: string[]
}

/** Relay answer to one published event */
export type PublishResult = { relay: string; ok: boolean; reason: string }
/** What a (debounced) send actually published: the signed event and per-relay answers */
export type Published = { event: NostrEvent; results: Promise<PublishResult[]> }

type DebounceEntry = {
  timeout: ReturnType<typeof setTimeout>
  resolvers: Array<(v: Published | null) => void>
}

const sendDebounceMap = new Map<string, DebounceEntry>()

// Relays keep one replaceable event per key and reject a replacement with the same created_at
// unless its id sorts lower ("replaced: have newer event"), so never reuse a second for a key.
const lastCreatedAt = new Map<string, number>()

function serializeTags(tags: string[][] = []): string {
  // Join inner arrays by unit-separator and outer by record-separator to avoid collisions
  try {
    if (!Array.isArray(tags)) return ''
    return tags.map(t => (Array.isArray(t) ? t.join('\u001F') : String(t))).join('\u001E')
  } catch {
    // Fallback to JSON
    try { return JSON.stringify(tags) } catch { return '' }
  }
}

function sendKey(kind: number, tags: string[][] = []): string {
  return `${Number(kind)}|${serializeTags(tags)}`
}

/**
 * Subscribe to events by hashtag/tag using Nostr's #t filter.
 * Defaults to all kinds; most join requests are kind 1 notes. Consumers can filter in callback.
 * @param tag - the hashtag value (without #)
 * @param onEvent - callback for events
 * @returns unsubscribe function
 */
export function nostrSubscribeTag(tag: string, onEvent: (event: NostrEvent, relay?: string) => void) {
  const key = `t:${tag}`
  // Close previous sub if any
  if (activeSubs.has(key)) {
    try { activeSubs.get(key)?.close?.() } catch { /* noop */ }
    activeSubs.delete(key)
  }
  const unsub = subscribeLive(
    // Filter by tag; don't constrain kind to catch any custom usage
    { '#t': [String(tag)] },
    (evt, relay) => {
      console.log('💧 [nostr] event', { tag, evt })
      onEvent(evt, relay)
    },
  )
  activeSubs.set(key, { close: unsub })
  return () => {
    try { unsub() } finally { activeSubs.delete(key) }
  }
}

// All PoW/NIP-13 mining logic removed intentionally.

/**
 * Subscribe to profile events (kind:0) for a set of authors. Keeps the subscription open.
 * Returns an unsubscribe function.
 */
export function subscribeProfiles(
  authors: string[],
  onProfile: (pubkey: string, profile: Record<string, unknown>, evt: NostrEvent) => void
) {
  const key = `authors:${authors.sort().join(',')}:k0`
  if (activeSubs.has(key)) {
    try { activeSubs.get(key)?.close?.() } catch {}
    activeSubs.delete(key)
  }
  const unsub = subscribeLive(
    {
      kinds: [0],
      authors: authors.map(String),
    },
    (evt) => {
      const pk = String(evt?.pubkey || '')
      if (!pk) return
      let obj: any = {}
      try { obj = JSON.parse(String(evt.content || '{}')) } catch { obj = {} }
      onProfile(pk, obj, evt)
    },
  )
  activeSubs.set(key, { close: unsub })
  return () => {
    try { unsub() } finally { activeSubs.delete(key) }
  }
}

/**
 * Fetch the latest kind:0 profile for a single pubkey across relays; resolves with parsed JSON or null.
 */
export async function fetchLatestProfile(pubkeyHex: string, timeoutMs = 3000): Promise<{ data: any; created_at: number } | null> {
  const authors = [String(pubkeyHex)]
  let latest: any | null = null
  let latestTs = 0

  await Promise.all(
    RELAYS.map((relay) =>
      new Promise<void>((resolve) => {
        let resolved = false
        const sub = pool.subscribeMany(
          [relay],
          {
            kinds: [0],
            authors,
          },
          {
            onevent: (evt) => {
              const ts = Number(evt?.created_at || 0)
              if (!latest || ts > latestTs) {
                latest = evt
                latestTs = ts
              }
            },
            oneose: () => {
              if (resolved) return
              try { sub.close() } catch {}
              resolved = true
              resolve()
            },
          }
        )
        setTimeout(() => {
          if (resolved) return
          try { sub.close() } catch {}
          resolved = true
          resolve()
        }, timeoutMs)
      })
    )
  )

  if (!latest) return null
  try {
    const data = JSON.parse(String(latest.content || '{}'))
    return { data, created_at: Number(latest.created_at || 0) }
  } catch {
    return null
  }
}

/**
 * Publish a Nostr event to all configured relays.
 * @param pubkeyHex - 32-byte hex public key
 * @param privkeyHex - 32-byte hex secret key
 * @param kind - event kind (0 for profile metadata, 1 for note, etc.)
 * @param content - event content
 * @param tags - event tags
 */
export async function send(
  pubkeyHex: string,
  privkeyHex: string,
  kind: number,
  content: string,
  tags: string[][] = [],
  originalContentForDbg: any = {},
  relays: string[] = RELAYS,
) {
  const key = sendKey(kind, tags)
  const latestArgs: SendArgs = { pubkeyHex, privkeyHex, kind, content, tags, originalContentForDbg, relays }

  // Inner function that actually performs the publish
  const doPublish = (args: SendArgs): Published | null => {
    try {
      const createdAt = Math.max(Math.floor(Date.now() / 1000), (lastCreatedAt.get(key) ?? 0) + 1)
      lastCreatedAt.set(key, createdAt)
      const evt: EventTemplate = {
        kind: Number(args.kind),
        created_at: createdAt,
        tags: Array.isArray(args.tags) ? args.tags : [],
        content: String(args.content ?? ''),
      }
      console.info(`💥[nostr] sending event k:${args.kind}, t:${serializeTags(args.tags)}`, { pubkeyHex: args.pubkeyHex, kind: args.kind, content: args.content, tags: args.tags, relays: args.relays, originalContentForDbg: args.originalContentForDbg })
      const sk = hexToBytes(String(args.privkeyHex))
      const rels = args.relays && args.relays.length ? args.relays : RELAYS
      const signed = finalizeEvent({ ...evt }, sk)
      const pubs = pool.publish(rels, signed)
      // Don't block UI: callers that care (sync status) await per-relay results
      const results = Promise.all(pubs.map((p, i) => p.then(
        (reason: any) => ({ relay: rels[i], ok: true, reason: String(reason ?? '') }),
        (e: any) => {
          const reason = String(e?.message ?? e)
          console.warn('[nostr] publish error:', rels[i], reason)
          // No answer at all: the socket died silently (dead zone), drop it so the retry dials again
          if (reason.includes('publish timed out')) pool.close([rels[i]])
          return { relay: rels[i], ok: false, reason }
        },
      )))
      return { event: signed, results }
    } catch (e) {
      console.warn('[nostr] send failed', e)
      return null
    }
  }

  // Return a promise that resolves when the debounced publish fires
  return new Promise<Published | null>((resolve) => {
    const existing = sendDebounceMap.get(key)
    if (existing) {
      console.log(`[nostr] 🐢 canceling on key ${key}`);
      clearTimeout(existing.timeout)
      existing.resolvers.push(resolve)
      existing.timeout = setTimeout(() => {
        const entry = sendDebounceMap.get(key)
        if (!entry) return
        let published: Published | null = null
        try {
          published = doPublish(latestArgs)
        } finally {
          sendDebounceMap.delete(key)
          for (const res of entry.resolvers) {
            res(published)
          }
        }
      }, RELAY_DEBOUNCE_MS)
    } else {
      console.log(`[nostr] 🐢 add postpone call ${key}`);

      const timeout = setTimeout(() => {
        const entry = sendDebounceMap.get(key)
        if (!entry) return
        let published: Published | null = null
        try {
          published = doPublish(latestArgs)
        } finally {
          sendDebounceMap.delete(key)
          for (const res of entry.resolvers) res(published)
        }
      }, RELAY_DEBOUNCE_MS)
      sendDebounceMap.set(key, {
        timeout,
        resolvers: [resolve],
      })
    }
  })
}

// PRE kind constant (parameterized replaceable event)
export const KIND_PRE = 30078

/** Send a PRE (kind 30078) with a d-tag and payload string.
 * Caller must provide a string (encrypted or pre-stringified JSON).
 */
export async function sendPRE(
  pubkeyHex: string,
  privkeyHex: string,
  dTag: string,
  payload: string,
  originalContentForDbg: any = {},
  relays: string[] = RELAYS,
) {
  const content = String(payload)
  return send(pubkeyHex, privkeyHex, KIND_PRE, content, [[ 'd', String(dTag) ]], originalContentForDbg, relays)
}

/**
 * Helper to publish a Nostr profile (kind 0) with basic fields.
 * Not strictly required by the app, but handy for store usage.
 */
export async function publishProfile(pubkeyHex: string, privkeyHex: string, profile: Record<string, unknown>) {
  const obj = profile && typeof profile === 'object' ? profile : {}
  return send(pubkeyHex, privkeyHex, 0, JSON.stringify(obj))
}

export async function publishProfileToRelays(
  pubkeyHex: string,
  privkeyHex: string,
  profile: Record<string, unknown>,
  relays: string[]
) {
  const obj = profile && typeof profile === 'object' ? profile : {}
  return send(pubkeyHex, privkeyHex, 0, JSON.stringify(obj), [], obj, relays)
}

/**
 * Fetch the latest kind:0 profile event for a pubkey from each relay and return a map of relay -> metadata hash (or null if none).
 */
export async function getProfileHashPerRelay(
  pubkeyHex: string,
  relays: string[] = RELAYS,
  timeoutMs = 3000
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {}

  await Promise.all(
    relays.map((relay) =>
      new Promise<void>((resolve) => {
        let latest: any | null = null
        let resolved = false;
        console.info('✏️ [nostr] fetching profile hash for', pubkeyHex, 'from relay', relay);
        const sub = pool.subscribeMany(
          [relay],
          {
            kinds: [0],
            authors: [String(pubkeyHex)],
            // get all, we'll pick latest at EOSE; many relays honor limit but order isn't guaranteed
          },
          {
            onevent: (evt) => {
              if (!latest || Number(evt?.created_at || 0) > Number(latest.created_at || 0)) {
                latest = evt
              }
            },
            oneose: async () => {
              if (resolved) return
              try {
                if (latest && typeof latest.content === 'string') {
                  let parsed: any
                  try { parsed = JSON.parse(latest.content) } catch { parsed = latest.content }
                  const canon = canonicalJSONStringify(parsed)
                  results[relay] = await sha256Hex(canon)
                } else {
                  results[relay] = null
                }
              } catch {
                results[relay] = null
              } finally {
                try { sub.close() } catch {}
                resolved = true
                resolve()
              }
            },
          }
        )

        // safety timeout
        const to = setTimeout(() => {
          if (resolved) return
          results[relay] = latest && typeof latest.content === 'string' ? null : null
          try { sub.close() } catch {}
          resolved = true
          resolve()
        }, timeoutMs)

        // If the subscription closes unexpectedly, ensure we clear timeout
        // Not all versions provide a close callback, but we ensure the timer clears when we resolve
        // Clear timer in resolve path above.
      })
    )
  )

  return results
}

/**
 * Fetch the latest PRE (kind 30078) for a d-tag from each relay and return relay->hash.
 * If authors provided, use it to narrow result set.
 */
export async function getPREHashPerRelay(
  dTag: string,
  authors?: string[] | null,
  relays: string[] = RELAYS,
  timeoutMs = 3000
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {}

  await Promise.all(
    relays.map((relay) =>
      new Promise<void>((resolve) => {
        let latest: any | null = null
        let resolved = false
        const filter: any = { kinds: [KIND_PRE], '#d': [String(dTag)] }
        if (authors && authors.length) filter.authors = authors.map(String)
        const sub = pool.subscribeMany(
          [relay],
          filter,
          {
            onevent: (evt) => {
              if (!latest || Number(evt?.created_at || 0) > Number(latest?.created_at || 0)) latest = evt
            },
            oneose: async () => {
              if (resolved) return
              try {
                if (latest && typeof latest.content === 'string') {
                  results[relay] = await sha256Hex(String(latest.content))
                } else {
                  results[relay] = null
                }
              } catch {
                results[relay] = null
              } finally {
                try { sub.close() } catch {}
                resolved = true
                resolve()
              }
            },
          }
        )
        setTimeout(() => {
          if (resolved) return
          try { sub.close() } catch {}
          results[relay] = latest ? null : null
          resolved = true
          resolve()
        }, timeoutMs)
      })
    )
  )

  return results
}

/**
 * Publish a PRE payload only to relays that need it (based on hash comparison).
 */
export async function publishPREToRelays(
  pubkeyHex: string,
  privkeyHex: string,
  dTag: string,
  payload: string,
  originalContentForDbg: any = {},
  relays: string[] = RELAYS
) {
  const hashes = await getPREHashPerRelay(dTag, [pubkeyHex], relays, 3000)
  let need: string[] = []
  try {
    const localHash = await sha256Hex(String(payload))
    need = relays.filter((r) => !hashes[r] || hashes[r] !== localHash)
  } catch {
    need = relays.slice()
  }
  if (!need.length) return
  return sendPRE(pubkeyHex, privkeyHex, dTag, payload, originalContentForDbg, need)
}

/** Fetch the latest PRE by d-tag across relays; returns latest event and relay. */
export async function fetchLatestPREByDTag(
  dTag: string,
  authors?: string[] | null,
  relays: string[] = RELAYS,
  timeoutMs = 3000
): Promise<{ event: any | null; relay: string | null }> {
  let latest: any | null = null
  let latestRelay: string | null = null
  await Promise.all(
    relays.map((relay) =>
      new Promise<void>((resolve) => {
        let resolved = false
        const sub = pool.subscribeMany(
          [relay],
          (() => { const f: any = { kinds: [KIND_PRE], '#d': [String(dTag)] }; if (authors && authors.length) f.authors = authors.map(String); return f })(),
          {
            onevent: (evt) => {
              const curTs = Number(evt?.created_at || 0)
              const bestTs = Number(latest?.created_at || 0)
              if (!latest || curTs > bestTs) {
                latest = evt
                latestRelay = relay
                console.info('💧 [nostr] latest PRE event', { dTag, latest, relay })
                return
              }
              if (curTs === bestTs) {
                // Tie-break by event id lexicographically to ensure deterministic latest
                const curId = String(evt?.id || '')
                const bestId = String(latest?.id || '')
                if (curId && bestId && curId.localeCompare(bestId) > 0) {
                  latest = evt
                  latestRelay = relay
                  console.info('💧 [nostr] latest PRE event (tie-break)', { dTag, latest, relay })
                }
              }
            },
            oneose: () => {
              if (resolved) return
              try { sub.close() } catch {}
              resolved = true
              resolve()
            },
          }
        )
        setTimeout(() => {
          if (resolved) return
          try { sub.close() } catch {}
          resolved = true
          resolve()
        }, timeoutMs)
      })
    )
  )
  return { event: latest, relay: latestRelay }
}

/**
 * Ask every relay separately for the newest PRE with this d-tag.
 * Per relay: the event, null when the relay answered without one, undefined when it did not answer.
 */
export async function fetchPREPerRelay(
  dTag: string,
  authors: string[],
  relays: string[] = RELAYS,
  timeoutMs = 4000,
): Promise<Record<string, NostrEvent | null | undefined>> {
  const results: Record<string, NostrEvent | null | undefined> = {}
  await Promise.all(
    relays.map((relay) =>
      new Promise<void>((resolve) => {
        let latest: NostrEvent | null = null
        let closedReason = ''
        let done = false
        const finish = (answered: boolean) => {
          if (done) return
          done = true
          clearTimeout(timer)
          results[relay] = answered ? latest : undefined
          try { sub.close() } catch {}
          resolve()
        }
        const sub = pool.subscribeMany(
          [relay],
          { kinds: [KIND_PRE], '#d': [String(dTag)], authors: authors.map(String) },
          {
            onevent: (evt) => {
              if (!latest || Number(evt?.created_at || 0) > Number(latest.created_at || 0)) latest = evt
            },
            // A failed connection reports EOSE right before onclose, so decide once both have run
            oneose: () => queueMicrotask(() => finish(!closedReason)),
            onclose: (reasons) => { closedReason = reasons.map((r) => r.reason).join(', ') || 'closed' },
          }
        )
        const timer = setTimeout(() => finish(false), timeoutMs)
      })
    )
  )
  return results
}

// Re-export helpers for convenience/compat with previous imports
export { canonicalJSONStringify, sha256Hex, computeMetadataHash } from '@/lib/utils'

export default {
  RELAYS,
  nostrSubscribeTag,
  subscribeLive,
  reconnectRelays,
  subscribeProfiles,
  send,
  sendPRE,
  publishProfile,
  publishProfileToRelays,
  canonicalJSONStringify,
  sha256Hex,
  computeMetadataHash,
  getProfileHashPerRelay,
  getPREHashPerRelay,
  publishPREToRelays,
  fetchLatestPREByDTag,
  fetchPREPerRelay,
  fetchLatestProfile,
}
