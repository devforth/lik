<template>
  <div class="p-4 space-y-4">
    <h1 class="text-xl font-semibold">My Profile</h1>
    <div class="space-y-2 max-w-md">
      <label class="text-sm text-muted-foreground">Username</label>
      <div class="flex items-center gap-2">
        <Input v-model="draftName" @keyup.enter="onSave" @blur="onSave" />
        <Button size="sm" v-if="showSave" @click="onSave">Save</Button>
      </div>
    </div>
    <div class="flex items-center gap-4">
      <img :src="avatar" alt="avatar" class="w-20 h-20 rounded-xl border" />
      <div class="space-y-1">
        <div class="text-sm text-muted-foreground">Avatar seed</div>
        <div class="font-mono text-sm">{{ seed }}</div>
        <Button size="sm" @click="regen">Regenerate</Button>
      </div>
    </div>

    <div class="mt-6 grid gap-3 sm:flex sm:items-center sm:gap-4">
      <!-- Backup drawer trigger -->
      <Drawer>
        <DrawerTrigger as-child>
          <Button variant="secondary">Backup private key</Button>
        </DrawerTrigger>
        <DrawerContent>
          <div class="mx-auto w-full max-w-lg p-4 space-y-4">
            <DrawerHeader class="p-0">
              <DrawerTitle>Back up your secret key</DrawerTitle>
              <DrawerDescription>
                This key unlocks your account and the scoreboards you created. Save it somewhere safe. If you clear the app cache or lose your phone, you'll need this key to restore everything. Please make a backup now to avoid losing data.
              </DrawerDescription>
            </DrawerHeader>
            <div class="space-y-3">
              <Button variant="outline" @click="mpReveal = true" :disabled="mpReveal" class="w-full justify-start">
                Show my secret code
              </Button>
              <div v-if="mpReveal" class="space-y-2">
                <label class="text-sm text-muted-foreground">Secret key</label>
                <div class="flex gap-2">
                  <input :value="nsec" readonly class="font-mono file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 flex-1 min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm" />
                  <Button size="sm" @click="copyNsec">Copy</Button>
                </div>
              </div>
            </div>
            <DrawerFooter class="p-0 flex gap-2 flex-col sm:flex-row">
              <DrawerClose as-child>
                <Button class="flex-1" :disabled="!mpReveal" @click="markBackupWritten">I wrote down my code</Button>
              </DrawerClose>
              <DrawerClose as-child>
                <Button variant="outline" class="flex-1" @click="remindLater">Remind me later</Button>
              </DrawerClose>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>

      <!-- Import drawer trigger -->
      <Drawer>
        <DrawerTrigger as-child>
          <Button>Import nsec</Button>
        </DrawerTrigger>
        <DrawerContent>
          <div class="mx-auto w-full max-w-lg p-4 space-y-4">
            <DrawerHeader>
              <DrawerTitle>Import private key</DrawerTitle>
              <DrawerDescription>
                Paste your nsec1 key to recover your profile and boards. This will erase all local data before importing.
              </DrawerDescription>
            </DrawerHeader>
            <div class="space-y-2">
              <label class="text-sm text-muted-foreground">nsec1…</label>
              <Input v-model="importNsec" placeholder="nsec1…" />
              <p class="text-xs text-muted-foreground">Warning: importing will clear local storage and re-download your profile and boards from relays.</p>
              <p v-if="importError" class="text-xs text-red-500">{{ importError }}</p>
            </div>
            <DrawerFooter>
              <Button :disabled="busy" @click="onImport">{{ busy ? 'Importing…' : 'Import' }}</Button>
              <DrawerClose as-child>
                <Button variant="outline">Cancel</Button>
              </DrawerClose>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger, DrawerClose } from '@/components/ui/drawer'
import { useUserStore } from '@/stores/user'
import { storeToRefs } from 'pinia'
import { onMounted, ref, computed, watch } from 'vue'
import { nip19, getPublicKey } from 'nostr-tools'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'
import { dbClearAll, dbPut } from '@/lib/idb'
import { useScoreboardsStore } from '@/stores/scoreboards'
import { fetchLatestProfile, fetchLatestPREByDTag, RELAYS } from '@/nostr'
import { toast } from 'vue-sonner'
import { useBackupReminderStore } from '@/stores/backupReminder'

const userStore = useUserStore()
const sbStore = useScoreboardsStore()

onMounted(() => {
  userStore.ensureUser()
})
const { nickname, avatarDataUri, avatarSeed } = storeToRefs(userStore)
const draftName = ref('')
// keep local draft in sync with store nickname (initially and on external updates)
watch(nickname, (n) => { draftName.value = n || '' }, { immediate: true })
const showSave = computed(() => {
  const n = (draftName.value || '').trim()
  return !!n && n !== (nickname.value || '')
})
async function onSave() {
  if (!showSave.value) return
  await userStore.updateNickname((draftName.value || '').trim())
}
const avatar = avatarDataUri
const seed = avatarSeed
const regen = () => userStore.regenerateAvatarSeed()

// nsec backup
const nsec = computed(() => {
  const hex = userStore.getPrivKey()
  if (!hex) return ''
  try { return nip19.nsecEncode(hexToBytes(hex)) } catch { return '' }
})
async function copyNsec() {
  try { await navigator.clipboard.writeText(nsec.value || '') ; toast.success('Key copied') } catch {}
}

// Import flow
const importNsec = ref('')
const importError = ref('')
const busy = ref(false)

// MyProfile backup drawer gated reveal
const mpReveal = ref(false)
const backupStore = useBackupReminderStore()
function markBackupWritten() { backupStore.markWritten() }
function remindLater() { backupStore.remindLater() }

async function onImport() {
  importError.value = ''
  const raw = (importNsec.value || '').trim()
  if (!raw) { importError.value = 'Enter nsec1 key' ; return }
  let skHex = ''
  try {
    const dec = nip19.decode(raw)
    if (dec.type !== 'nsec') throw new Error('Not an nsec key')
    const bytes = dec.data as Uint8Array
    skHex = bytesToHex(bytes)
  } catch (e:any) {
    importError.value = 'Invalid nsec key'
    return
  }
  busy.value = true
  try {
    // derive pubkey
    const pkHex = getPublicKey(hexToBytes(skHex))

    // wipe local data
    await dbClearAll()
    // also reset in-memory stores/subscriptions
    try { 
      sbStore.stopJoinSubscriptions(); 
      sbStore.stopAllCRDTSubscriptions(); 
      sbStore.stopAllBoardMetaSubscriptions() 
    } catch {}
    sbStore.items.splice(0, sbStore.items.length)

    // seed user profile minimally (will be enriched from kind 0)
    const now = Date.now()
    const minimal = {
      id: pkHex,
      nickname: 'user',
      pubkeyHex: pkHex,
      privkeyHex: skHex,
      createdAt: now,
      avatarSeed: 'user',
    }
    // Save via store API by setting state directly then calling updateNickname later
  ;(userStore as any).profile.value = minimal as any
    await dbPut('user', minimal)
    // Fetch latest kind:0 profile
    try {
      const prof = await fetchLatestProfile(pkHex, 4000)
      const data: any = prof?.data || {}
      const name = String(data?.name || data?.display_name || data?.username || '') || 'user'
      const picture = String(data?.picture || '')
      // update store fields
      await userStore.updateNickname(name)
      userStore.profile!.avatarSeed = name
      await dbPut('user', userStore.profile)
    } catch {}

    // Recover boards: search known relays for PREs
    const recovered = new Set<string>()
    // We don't have an index; attempt to discover by scanning CRDT/BRD isn't possible without ids.
    // Heuristic: look for events authored by this pubkey with kind 30078 and d tag starting with lik::brd::
    // We can probe a small set of likely board ids from join codes not available; fallback is to do nothing if none found.
    // Since broad search isn't feasible without an index, rely on other members publishing our board PRE where owner==pkHex.
    // We'll try to fetch from a fixed list of candidate ids if they've been previously in IDB (now cleared) - none.
    // As an alternative, we keep it minimal here.

    // Note: A better approach is a relay-side search by authors + kind + #d prefix, but nostr-tools filter doesn't support prefix.
    // We'll try to fetch boards referenced by CRDT PREs authored by pkHex across relays by scanning EOSE limited window per relay.
    // Implement a small per-relay scan for PREs authored by pkHex and parse d tag values we get back during EOSE.
    const { SimplePool } = await import('nostr-tools/pool')
    const pool = new SimplePool()

    const brdIds: string[] = []
    await Promise.all(RELAYS.map((relay) => new Promise<void>((resolve) => {
      let resolved = false
      const sub = pool.subscribeMany([relay], [ { kinds: [30078], authors: [pkHex] } as any ], {
        onevent: (evt: any) => {
          try {
            const tags: any[] = Array.isArray(evt?.tags) ? evt.tags : []
            const d = tags.find((t) => Array.isArray(t) && t[0] === 'd')?.[1]
            if (typeof d === 'string') {
              if (d.startsWith('lik::brd::')) {
                const id = d.slice('lik::brd::'.length)
                if (id && !brdIds.includes(id)) brdIds.push(id)
              } else if (d.startsWith('lik::crdt::')) {
                const id = d.slice('lik::crdt::'.length)
                if (id && !brdIds.includes(id)) brdIds.push(id)
              }
            }
          } catch {}
        },
        oneose: () => {
          if (resolved) return; try { sub.close() } catch {}; resolved = true; resolve()
        },
      })
      setTimeout(() => { if (resolved) return; try { sub.close() } catch {}; resolved = true; resolve() }, 2500)
    })))

    // For each candidate board id, fetch brd and crdt PREs; decrypt using owner-derived secret and add only if both available
    for (const id of brdIds) {
      try {
        const { event: brdEvt } = await fetchLatestPREByDTag(`lik::brd::${id}`, null)
        const { event: crdtEvt } = await fetchLatestPREByDTag(`lik::crdt::${id}`, null)
        if (!brdEvt || !crdtEvt) continue
        // Derive board secret as sha512Hex(`${priv}::${id}`)
        const { sha512Hex, aesDecryptFromBase64 } = await import('@/lib/utils')
        const secret = await sha512Hex(`${skHex}::${id}`)
        const metaStr = await aesDecryptFromBase64(secret, String(brdEvt.content || ''))
        const crdtStr = await aesDecryptFromBase64(secret, String(crdtEvt.content || ''))
        const meta = JSON.parse(metaStr)
        const snapshot = JSON.parse(crdtStr)
        if (!meta?.id || meta.id !== id) continue
        // Add to local store
        const exists = sbStore.items.find((s) => s.id === id)
        if (exists) continue
        sbStore.items.push({
          id,
          name: String(meta.name || 'Scoreboard'),
          createdAt: Date.now(),
          authorPubKey: String(meta.owner || pkHex),
          editors: Array.isArray(meta.editors) ? meta.editors.map(String) : [],
          participants: Array.isArray(meta.participants) ? meta.participants.map((p: any) => ({ id: String(p.id), name: String(p.name || '') })) : [],
          snapshot,
          secret,
        })
        recovered.add(id)
      } catch {}
    }

    // Persist and resubscribe
    await sbStore.ensureLoaded()
    // saveAll is internal; rely on watcher by making a small mutation
    // Alternatively, call a private function via updateSnapshot or add method
    // Trigger CRDT subscriptions for recovered boards
    for (const id of recovered) {
      sbStore.subscribeBoardCRDT(id)
      try { sbStore.subscribeBoardMeta(id) } catch {}
    }

    toast.success('Key imported', { description: `${recovered.size} boards recovered` })
  } catch (e:any) {
    console.error('import failed', e)
    importError.value = 'Import failed'
  } finally {
    busy.value = false
  }
}
</script>
