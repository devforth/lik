import type { ClassValue } from "clsx"
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---- JSON and hashing helpers (moved from src/nostr.ts) ----

/** Stable, canonical JSON stringify (sorted object keys, stable arrays). */
export function canonicalJSONStringify(input: unknown): string {
  const seen = new WeakSet()
  const stringify = (value: any): any => {
    if (value === null || typeof value !== 'object') return value
    if (seen.has(value)) return null
    seen.add(value)
    if (Array.isArray(value)) return value.map((v) => stringify(v))
    const out: Record<string, any> = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = stringify(value[key])
    }
    return out
  }
  return JSON.stringify(stringify(input))
}

/** Compute SHA-256 hex of a string using Web Crypto. */
export async function sha256Hex(data: string): Promise<string> {
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(data))
  const bytes = new Uint8Array(digest)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Compute canonical hash for a profile metadata object. */
export async function computeMetadataHash(obj: Record<string, unknown>): Promise<string> {
  const canon = canonicalJSONStringify(obj)
  return sha256Hex(canon)
}

// ---- IDs ----

/**
 * shortId: short, non-cryptographic id suitable for UI/category ids.
 * Format: base36 timestamp + 2-3 base36 random chars (e.g., "lmg5s-3k").
 */
export function shortId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.floor(Math.random() * 36 * 36 * 36)
    .toString(36)
    .padStart(3, '0')
  return `${ts}-${rand}`
}

export default shortId
