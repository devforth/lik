import { defineStore } from 'pinia'
import { ref } from 'vue'
import { subscribeProfiles } from '@/nostr'
import { dbGetAll, dbPut } from '@/lib/idb'
import { useUserStore } from '@/stores/user'

export interface Profile {
  pubkey: string
  name: string
  picture: string
  updatedAt: number
}

export const useProfilesStore = defineStore('profiles', () => {
  const profiles = ref<Map<string, Profile>>(new Map())
  let unsub: null | (() => void) = null
  const tracked = ref<string[]>([])

  const STORE = 'profiles'

  async function loadAll(): Promise<Profile[]> {
    try {
      return await dbGetAll<Profile>(STORE)
    } catch (e) {
      console.warn('[profiles] loadAll failed', e)
      return []
    }
  }

  async function save(p: Profile) {
    try {
      await dbPut(STORE, { ...p })
    } catch (e) {
      console.warn('[profiles] save failed', e)
    }
  }

  // hydrate cache first
  void (async () => {
    const rows = await loadAll()
    for (const r of rows) profiles.value.set(r.pubkey, r)
  })()

  function upsertProfile(pubkey: string, name: string, picture: string, updatedAt: number) {
    const existing = profiles.value.get(pubkey)
    const next: Profile = {
      pubkey,
      name: String(name || '').trim(),
      picture: String(picture || '').trim(),
      updatedAt,
    }
    const changed = !existing || existing.name !== next.name || existing.picture !== next.picture
    profiles.value.set(pubkey, next)
    if (changed) void save(next)
  }

  function setTrackedPubkeys(pubkeys: string[]) {
    const unique = Array.from(new Set(pubkeys.filter(Boolean)))
    // Only resubscribe if changed
    if (unique.length === tracked.value.length && unique.every((v, i) => v === tracked.value[i])) {
      return
    }
    tracked.value = unique
    if (unsub) { try { unsub() } catch {} ; unsub = null }
    if (!unique.length) return
    unsub = subscribeProfiles(unique, (pubkey, data: any, evt: any) => {
      const name = String(data?.name || data?.display_name || data?.username || '')
      const picture = String(data?.picture || '')
      const ts = Number(evt?.created_at || Math.floor(Date.now() / 1000))
      // store profiles only for tracked (i.e., members)
      upsertProfile(pubkey, name, picture, ts)
    })
  }

  function get(pubkey: string): Profile | null {
    // Prefer live data from the user store for the current user
    try {
      const user = useUserStore()
      const myPub = user.getPubKey()
      console.log('[profiles] get', { pubkey, myPub, user })
      if (myPub && pubkey === myPub) {
        const name = user.nickname || ''
        const picture = user.avatarDataUri || ''
        return {
          pubkey,
          name: String((name as any)?.value ?? name ?? ''),
          picture: String((picture as any)?.value ?? picture ?? ''),
          updatedAt: Date.now(),
        }
      }
    } catch (e) {
      console.error(`[profiles] get failed by pub ${pubkey}`, e)
    }
    return profiles.value.get(pubkey) || null
  }

  return {
    profiles,
    get,
    setTrackedPubkeys,
    upsertProfile,
  }
})
