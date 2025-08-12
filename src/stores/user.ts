import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { uniqueNamesGenerator, adjectives, animals, colors } from 'unique-names-generator'
import { bytesToHex } from 'nostr-tools/utils'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { createAvatar } from '@dicebear/core'
import { thumbs } from '@dicebear/collection'
import {
  RELAYS as NOSTR_RELAYS,
  publishProfile as nostrPublishProfile,
  publishProfileToRelays as nostrPublishProfileToRelays,
  computeMetadataHash,
  getProfileHashPerRelay,
} from '@/nostr'

export interface UserProfile {
  id: string // same as pubkey for convenience
  nickname: string
  pubkeyHex: string
  privkeyHex: string
  createdAt: number
  avatarSeed: string
}

export const useUserStore = defineStore('user', () => {
  const profile = ref<UserProfile | null>(null)

  // IndexedDB setup
  const DB_NAME = 'appdb'
  const DB_VERSION = 2 // adding fields on an object store doesn't require version bump
  const STORE = 'user'
  let idb: IDBDatabase | null = null

  function openIdb(name: string, version: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
        // Also ensure scoreboards store remains created if DB was empty
        if (!db.objectStoreNames.contains('scoreboards')) {
          db.createObjectStore('scoreboards', { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async function ensureDb(): Promise<IDBDatabase | null> {
    if (idb) return idb
    try {
      idb = await openIdb(DB_NAME, DB_VERSION)
      return idb
    } catch (e) {
      console.warn('[user] IndexedDB unavailable, persistence disabled', e)
      return null
    }
  }

  async function loadExisting(): Promise<UserProfile | null> {
    const db = await ensureDb()
    if (!db) return null
    try {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const rows: any[] = await new Promise((resolve, reject) => {
        const req = store.getAll()
        req.onsuccess = () => resolve(req.result as any[])
        req.onerror = () => reject(req.error)
      })
      return (rows && rows[0])
        ? {
            id: String(rows[0].id),
            nickname: String(rows[0].nickname || ''),
            pubkeyHex: String(rows[0].pubkeyHex || ''),
            privkeyHex: String(rows[0].privkeyHex || ''),
            createdAt: Number(rows[0].createdAt || 0),
            // For older records, fallback avatar seed to nickname
            avatarSeed: String(rows[0].avatarSeed || rows[0].nickname || ''),
          }
        : null
    } catch (e) {
      console.warn('[user] loadExisting failed', e)
      return null
    }
  }

  async function saveProfile(p: UserProfile) {
    const db = await ensureDb()
    if (!db) return
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    store.put(JSON.parse(JSON.stringify(p))) // ensure no circular refs
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }

  function generateNickname(): string {
    return uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: '-',
      style: 'lowerCase',
      length: 2,
    }) + (Math.random() * 100).toFixed(0)
  }

  function generateNostrKeys(): { pubkeyHex: string; privkeyHex: string } {
    const sk = generateSecretKey() // Uint8Array(32)
    const pkHex = getPublicKey(sk) // hex string
    return { pubkeyHex: pkHex, privkeyHex: bytesToHex(sk) }
  }

  async function ensureUser(): Promise<UserProfile> {
    if (profile.value) return profile.value

    const existing = await loadExisting()
    if (existing && existing.privkeyHex && existing.pubkeyHex) {
      profile.value = existing
      // Trigger verification/publish after loading from IDB
      scheduleProfileSync('startup-load')
      return existing
    }

    const nickname = generateNickname()
    const { pubkeyHex, privkeyHex } = generateNostrKeys()
    const p: UserProfile = {
      id: pubkeyHex,
      nickname,
      pubkeyHex,
      privkeyHex,
      createdAt: Date.now(),
      avatarSeed: nickname, // default seed equals username
    }
    profile.value = p
    await saveProfile(p)
    // Immediately publish new profile to Nostr
    try {
      await publishProfileToNostr()
    } catch (e) {
      console.warn('[user] initial Nostr profile publish failed', e)
    }
    return p
  }

  const pubkey = computed(() => profile.value?.pubkeyHex ?? null)
  const privkey = computed(() => profile.value?.privkeyHex ?? null)
  const nickname = computed(() => profile.value?.nickname ?? '')
  const avatarSeed = computed(() => profile.value?.avatarSeed ?? '')

  // Avatar helpers
  function avatarSvg(seed?: string): string {
    const s = seed || avatarSeed.value || nickname.value || 'user'
    try {
      return createAvatar(thumbs, { seed: s }).toString()
    } catch (_) {
      // in case something goes wrong, return a simple placeholder circle
      return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#eee"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-size="20" fill="#999">🙂</text></svg>`
    }
  }

  const avatarDataUri = computed(() => {
    const svg = avatarSvg()
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
  })

  async function regenerateAvatarSeed() {
    const seed = Math.random().toString(36).slice(2, 10)
    if (!profile.value) await ensureUser()
    if (profile.value) {
      profile.value.avatarSeed = seed
      await saveProfile(profile.value)
    }
  }

  async function updateNickname(newName: string) {
    const n = (newName ?? '').trim()
    if (!profile.value) await ensureUser()
    if (!profile.value) return
    if (!n) return
    if (profile.value.nickname === n) return
    profile.value.nickname = n
    await saveProfile(profile.value)
  }

  // Build current metadata object consistently
  function currentMetadata() {
    const p = profile.value
    return {
      name: p?.nickname || '',
      picture: avatarDataUri.value,
      about: 'LIK user',
    }
  }

  // Publish the current profile metadata to Nostr (kind 0), verifying per-relay hash and re-publishing if needed
  async function publishProfileToNostr() {
    const p = await ensureUser()
    const meta = currentMetadata()
    const localHash = await computeMetadataHash(meta)

    // Ask each relay for our latest kind:0 and compute its hash
    let remoteHashes: Record<string, string | null> = {}
    try {
      remoteHashes = await getProfileHashPerRelay(p.pubkeyHex, NOSTR_RELAYS, 3000)
    } catch (e) {
      console.warn('[user] getProfileHashPerRelay failed', e)
    }

    console.log('[user] got hashes from relays', remoteHashes)

    // Determine which relays need an update
    const needUpdate: string[] = []
    for (const r of NOSTR_RELAYS) {
      const h = remoteHashes[r]
      if (!h || h !== localHash) needUpdate.push(r)
    }

    if (needUpdate.length === 0) return

    // Publish to relays that need it
    try {
      await nostrPublishProfileToRelays(p.pubkeyHex, p.privkeyHex, meta, needUpdate)
    } catch (e) {
      console.warn('[user] publishProfileToRelays failed', e)
    }
  }

  // Debounced schedule to avoid spamming relays on rapid changes
  let syncTimer: number | null = null
  function scheduleProfileSync(reason: string, delayMs = 300) {
    if (syncTimer) window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      syncTimer = null
      void publishProfileToNostr()
    }, delayMs)
  }

  // Auto-publish on nickname or avatarSeed change
  watch(
    () => [nickname.value, avatarSeed.value],
    () => scheduleProfileSync('profile-change'),
    { deep: false }
  )

  // Hourly ensure relays have the latest profile
  let hourlyTimer: number | null = null
  function startHourlySync() {
    // run once shortly after init, then every hour
    scheduleProfileSync('hourly-initial', 1000)
    if (hourlyTimer) window.clearInterval(hourlyTimer)
    hourlyTimer = window.setInterval(() => void publishProfileToNostr(), 60 * 60 * 1000)
  }

  function getPubKey(): string | null { return pubkey.value }
  function getPrivKey(): string | null { return privkey.value }

  // auto-init when store is first used
  void ensureUser().then(() => startHourlySync())

  return {
    profile,
    ensureUser,
    // getters for other modules
  pubkey,
  privkey,
    nickname,
  avatarSeed,
  avatarDataUri,
  avatarSvg,
  getPubKey,
  getPrivKey,
  regenerateAvatarSeed,
  updateNickname,
  publishProfileToNostr,
  }
})
