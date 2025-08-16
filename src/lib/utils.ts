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

/** Compute SHA-512 hex of a string using Web Crypto. */
export async function sha512Hex(data: string): Promise<string> {
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-512', enc.encode(data))
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

// ---- AES-GCM helpers for app encryption ----

function hexToBytes(hex: string): Uint8Array {
  const s = hex.replace(/[^0-9a-fA-F]/g, '')
  const arr = new Uint8Array(s.length / 2)
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(s.substr(i * 2, 2), 16)
  return arr
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function importAesKeyFromSecretHex(secretHex: string): Promise<CryptoKey> {
  // Secret is a hex string (e.g., SHA-512 hex). Import as raw for AES-GCM
  const raw = hexToBytes(secretHex)
  // If length isn't 16/24/32 bytes, derive a 32-byte key via SHA-256 of raw
  let keyData = raw
  if (![16, 24, 32].includes(raw.length)) {
    const buf = toArrayBuffer(raw)
    const digest = await crypto.subtle.digest('SHA-256', buf as ArrayBuffer)
    keyData = new Uint8Array(digest)
  }
  const keyBuf = toArrayBuffer(keyData)
  return crypto.subtle.importKey('raw', keyBuf as ArrayBuffer, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(u8.byteLength)
  new Uint8Array(buf).set(u8)
  return buf
}

/** Encrypt a UTF-8 string with AES-GCM using secret hex; returns base64(iv||ciphertext) */
export async function aesEncryptToBase64(secretHex: string, plaintext: string): Promise<string> {
  const key = await importAesKeyFromSecretHex(secretHex)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder().encode(plaintext)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc))
  const payload = new Uint8Array(iv.length + ct.length)
  payload.set(iv, 0)
  payload.set(ct, iv.length)
  return bytesToBase64(payload)
}

/** Decrypt a base64(iv||ciphertext) with AES-GCM using secret hex; returns UTF-8 string */
export async function aesDecryptFromBase64(secretHex: string, payloadB64: string): Promise<string> {
  const key = await importAesKeyFromSecretHex(secretHex)
  const bytes = base64ToBytes(payloadB64)
  if (bytes.length < 13) throw new Error('Payload too short')
  const iv = bytes.slice(0, 12)
  const ct = bytes.slice(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}
