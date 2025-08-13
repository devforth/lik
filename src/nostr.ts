// Lightweight Nostr client glue for the app
// - connects to a few popular public relays
// - exposes subscribeTag(tag, onEvent?) => unsubscribe
// - exposes send(pubkey, privkey, kind, content, tags?) => Promise<void>

import { SimplePool } from 'nostr-tools/pool'
import type { EventTemplate } from 'nostr-tools'
import { finalizeEvent } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import { canonicalJSONStringify, sha256Hex, computeMetadataHash } from '@/lib/utils'

export type NostrEvent = any

// Three popular, free, public relays
export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nostr.mom',
  'wss://relay.nostr.net',
  'wss://relay.primal.net',
  
]

// Shared pool instance for the whole app
const pool = new SimplePool()

// Keep local refs to open subscriptions by key for optional housekeeping
const activeSubs = new Map<string, { close: () => void }>()

/**
 * Subscribe to events by hashtag/tag using Nostr's #t filter.
 * Defaults to all kinds; most join requests are kind 1 notes. Consumers can filter in callback.
 * @param tag - the hashtag value (without #)
 * @param onEvent - callback for events
 * @returns unsubscribe function
 */
export function subscribeTag(tag: string, onEvent?: (event: NostrEvent, relay?: string) => void) {
  const key = `t:${tag}`
  // Close previous sub if any
  if (activeSubs.has(key)) {
    try { activeSubs.get(key)?.close?.() } catch { /* noop */ }
    activeSubs.delete(key)
  }
  const sub = pool.subscribeMany(
    RELAYS,
    [
      // Filter by tag; don't constrain kind to catch any custom usage
      { '#t': [String(tag)] },
    ],
    {
      onevent: (evt) => {
        if (onEvent) onEvent(evt)
        else console.log('[nostr] event', tag, evt)
      },
      oneose: () => {
        // End-of-stored-events marker from relays; keep subscription open for future events
  },
    }
  )
  activeSubs.set(key, sub)
  return () => {
    try { sub.close() } finally { activeSubs.delete(key) }
  }
}

// All PoW/NIP-13 mining logic removed intentionally.

/** Normalize publish return to an array of promises for easier awaiting. */
function toPromises(x: any): Promise<any>[] {
  if (!x) return []
  if (Array.isArray(x)) return x
  if (typeof x.then === 'function') return [x]
  if (typeof x[Symbol.iterator] === 'function') return Array.from(x)
  return []
}

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
  const sub = pool.subscribeMany(
    RELAYS,
    [
      {
    kinds: [0],
        authors: authors.map(String),
      },
    ],
    {
      onevent: (evt) => {
        const pk = String(evt?.pubkey || '')
        if (!pk) return
        let obj: any = {}
        try { obj = JSON.parse(String(evt.content || '{}')) } catch { obj = {} }
        onProfile(pk, obj, evt)
      },
      oneose: () => {
        // keep it open
      },
    }
  )
  activeSubs.set(key, sub)
  return () => {
    try { sub.close() } finally { activeSubs.delete(key) }
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
          [
            {
              kinds: [0],
              authors,
            },
          ],
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
  relays: string[] = RELAYS
) {
  try {
    const evt: EventTemplate = {
      kind: Number(kind),
      created_at: Math.floor(Date.now() / 1000),
      tags: Array.isArray(tags) ? tags : [],
      content: String(content ?? ''),
    }
    console.info('[nostr] sending event', { pubkeyHex, kind, content, tags, relays })
    const sk = hexToBytes(String(privkeyHex))
    const rels = relays && relays.length ? relays : RELAYS
    const signed = finalizeEvent({ ...evt }, sk)
    const pubs = toPromises(pool.publish(rels, signed) as any)
   // Fire-and-forget: log failures but don't block UI
    for (const p of pubs) p.catch((e: any) => console.warn('[nostr] publish error:', e?.message ?? e))
  } catch (e) {
    console.warn('[nostr] send failed', e)
  }
}

// PRE kind constant (parameterized replaceable event)
export const KIND_PRE = 30078

/** Send a PRE (kind 30078) with a d-tag and JSON payload. */
export async function sendPRE(
  pubkeyHex: string,
  privkeyHex: string,
  dTag: string,
  payload: any,
  relays: string[] = RELAYS
) {
  const content = JSON.stringify(payload ?? {})
  return send(pubkeyHex, privkeyHex, KIND_PRE, content, [[ 'd', String(dTag) ]], relays)
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
  return send(pubkeyHex, privkeyHex, 0, JSON.stringify(obj), [], relays)
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
        console.info('[nostr] fetching profile hash for', pubkeyHex, 'from relay', relay);
        const sub = pool.subscribeMany(
          [relay],
          [
            {
              kinds: [0],
              authors: [String(pubkeyHex)],
              // get all, we'll pick latest at EOSE; many relays honor limit but order isn't guaranteed
            },
          ],
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
          [ filter ],
          {
            onevent: (evt) => {
              if (!latest || Number(evt?.created_at || 0) > Number(latest?.created_at || 0)) latest = evt
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
  payload: any,
  relays: string[] = RELAYS
) {
  const hashes = await getPREHashPerRelay(dTag, [pubkeyHex], relays, 3000)
  let need: string[] = []
  try {
    const canon = canonicalJSONStringify(payload ?? {})
    const localHash = await sha256Hex(canon)
    need = relays.filter((r) => !hashes[r] || hashes[r] !== localHash)
  } catch {
    need = relays.slice()
  }
  if (!need.length) return
  return sendPRE(pubkeyHex, privkeyHex, dTag, payload, need)
}

/** Fetch the latest PRE by d-tag across relays; returns latest event and relay. */
export async function fetchLatestPREByDTag(
  dTag: string,
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
          [ { kinds: [KIND_PRE], '#d': [String(dTag)] } as any ],
          {
            onevent: (evt) => {
              if (!latest || Number(evt?.created_at || 0) > Number(latest?.created_at || 0)) {
                latest = evt
                latestRelay = relay
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

// Re-export helpers for convenience/compat with previous imports
export { canonicalJSONStringify, sha256Hex, computeMetadataHash } from '@/lib/utils'

export default {
  RELAYS,
  subscribeTag,
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
  fetchLatestProfile,
}
