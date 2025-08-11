// Lightweight Nostr client glue for the app
// - connects to a few popular public relays
// - exposes subscribeTag(tag, onEvent?) => unsubscribe
// - exposes send(pubkey, privkey, kind, content, tags?) => Promise<void>

import { SimplePool } from 'nostr-tools/pool'
import type { EventTemplate } from 'nostr-tools'
import { finalizeEvent } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'

export type NostrEvent = any

// Three popular, free, public relays
export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
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
        else console.debug('[nostr] event', tag, evt)
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

/**
 * Publish a Nostr event to all configured relays.
 * @param pubkeyHex - 32-byte hex public key
 * @param privkeyHex - 32-byte hex secret key
 * @param kind - event kind (0 for profile metadata, 1 for note, etc.)
 * @param content - event content
 * @param tags - event tags
 */
export async function send(pubkeyHex: string, privkeyHex: string, kind: number, content: string, tags: string[][] = []) {
  try {
  const evt: EventTemplate = {
      kind: Number(kind),
      created_at: Math.floor(Date.now() / 1000),
      tags: Array.isArray(tags) ? tags : [],
      content: String(content ?? ''),
    }
    const sk = hexToBytes(String(privkeyHex))
    const signed = finalizeEvent(evt, sk)
    // Fire-and-forget publish to all relays; don't await acks to keep UI snappy
    pool.publish(RELAYS, signed)
  } catch (e) {
    console.warn('[nostr] send failed', e)
  }
}

/**
 * Helper to publish a Nostr profile (kind 0) with basic fields.
 * Not strictly required by the app, but handy for store usage.
 */
export async function publishProfile(pubkeyHex: string, privkeyHex: string, profile: Record<string, unknown>) {
  const obj = profile && typeof profile === 'object' ? profile : {}
  return send(pubkeyHex, privkeyHex, 0, JSON.stringify(obj))
}

export default {
  RELAYS,
  subscribeTag,
  send,
  publishProfile,
}
