import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { uniqueNamesGenerator, adjectives, animals, colors } from 'unique-names-generator'
import { bytesToHex } from 'nostr-tools/utils'
import { generateSecretKey, getPublicKey } from 'nostr-tools'

export interface UserProfile {
  id: string // same as pubkey for convenience
  nickname: string
  pubkeyHex: string
  privkeyHex: string
  createdAt: number
}

export const useUserStore = defineStore('user', () => {
  const profile = ref<UserProfile | null>(null)

  // IndexedDB setup
  const DB_NAME = 'appdb'
  const DB_VERSION = 2 // bump version to add `user` store if not present
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
    store.put(p)
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
    }
    profile.value = p
    await saveProfile(p)
    return p
  }

  const pubkey = computed(() => profile.value?.pubkeyHex ?? null)
  const privkey = computed(() => profile.value?.privkeyHex ?? null)
  const nickname = computed(() => profile.value?.nickname ?? '')

  function getPubKey(): string | null { return pubkey.value }
  function getPrivKey(): string | null { return privkey.value }

  // auto-init when store is first used
  void ensureUser()

  return {
    profile,
    ensureUser,
    // getters for other modules
  pubkey,
  privkey,
    nickname,
  getPubKey,
  getPrivKey,
  }
})
