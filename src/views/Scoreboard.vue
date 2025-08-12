<template>
  <!-- Not found state -->
  <div v-if="notFound" class="p-4">
    <div class="max-w-screen-sm mx-auto text-center space-y-4 py-16">
      <h1 class="text-2xl font-semibold">Scoreboard not found</h1>
      <p class="text-sm text-muted-foreground">We couldn't find a scoreboard with ID <span class="font-mono">{{ id }}</span> on this device.</p>
      <div class="flex items-center justify-center gap-3">
        <Button @click="goCreate">Create new one</Button>
      </div>
    </div>
  </div>

  <div v-else class="p-4 space-y-6">
    <div class="flex items-start justify-between gap-2">
      <div>
        <h1 class="text-2xl font-semibold">{{ scoreboard?.name ?? 'Scoreboard' }}</h1>
        <div class="text-xs text-gray-500 mt-2">UUID: {{ id }}</div>
      </div>

      <!-- Actions: kebab menu -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon" class="h-8 w-8">
            <MoreVertical class="h-5 w-5" />
            <span class="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-44">
          <DropdownMenuItem @click="openSettings()">
            <Settings class="h-4 w-4" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuItem @click="openInvite()">
            <QrCode class="h-4 w-4" />
            <span>Invite to board</span>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" @click="openConfirm()">
            <Trash2 class="h-4 w-4" />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>



    <!-- Confirm delete drawer -->
    <Drawer v-model:open="drawerOpen">
      <DrawerContent>
        <div class="mx-auto w-full max-w-sm">
          <DrawerHeader>
            <DrawerTitle>Delete scoreboard?</DrawerTitle>
            <DrawerDescription>
              Are you sure you want to delete this scoreboard? If it exists for other members, they have to delete it by themselves.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button variant="destructive" @click="confirmDelete">Yes, delete</Button>
            <DrawerClose as-child>
              <Button variant="outline">No, keep</Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>

    <!-- Invite drawer -->
    <Drawer v-model:open="inviteOpen">
      <DrawerContent>
        <div class="mx-auto w-full max-w-sm">
          <DrawerHeader>
            <DrawerTitle>Invite to scoreboard</DrawerTitle>
            <DrawerDescription>
              Let your teammate scan the QR code or copy the board ID and share it.
            </DrawerDescription>
          </DrawerHeader>

          <div class="px-4 pb-2 flex flex-col items-center gap-4">
            <QrcodeVue :value="boardId" :size="192" level="M" class="rounded-md border p-2 bg-card" />

            <div class="w-full flex items-center gap-2">
              <Input :model-value="boardId" readonly class="font-mono text-sm" />
              <Button variant="outline" size="icon" @click="copyBoardId" :aria-label="copied ? 'Copied' : 'Copy'">
                <component :is="copied ? Check : Copy" class="h-4 w-4" />
              </Button>
            </div>

            <div class="w-full text-left text-sm text-muted-foreground">
              Ask the invited user to open the LIK app, tap "Join to scoreboard" in the sidebar, then scan this QR code or enter the board ID manually from the input above.
            </div>
          </div>

          <DrawerFooter>
            <DrawerClose as-child>
              <Button variant="outline">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>

    <!-- Settings drawer: owner and members list -->
    <Drawer v-model:open="settingsOpen">
      <DrawerContent>
        <div class="mx-auto w-full max-w-md">
          <DrawerHeader>
            <DrawerTitle>Scoreboard settings</DrawerTitle>
            <DrawerDescription>Owner and members</DrawerDescription>
          </DrawerHeader>

          <div class="px-4 pb-4 space-y-6">
            <div>
              <div class="text-xs text-muted-foreground mb-2">Owner</div>
              <div v-if="ownerProfile" class="flex items-center gap-3">
                <img :src="ownerProfile.picture || ''" class="h-9 w-9 rounded-md bg-muted object-cover" alt="owner" />
                <div class="text-sm font-medium">{{ ownerProfile.name || short(ownerProfile.pubkey) }}</div>
              </div>
              <div v-else class="text-sm text-muted-foreground">Unknown</div>
            </div>

            <div>
              <div class="text-xs text-muted-foreground mb-2">Members ({{ members.length }})</div>
              <div v-if="members.length" class="space-y-2">
                <div v-for="m in members" :key="m.pubkey" class="flex items-center gap-3">
                  <img :src="m.picture || ''" class="h-8 w-8 rounded-md bg-muted object-cover" alt="avatar" />
                  <div class="min-w-0">
                    <div class="text-sm truncate">{{ m.name || short(m.pubkey) }}</div>
                  </div>
                </div>
              </div>
              <div v-else class="text-sm text-muted-foreground">No members yet</div>
            </div>
          </div>

          <DrawerFooter>
            <DrawerClose as-child>
              <Button variant="outline">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>

    <!-- Owner: last 3 join requests -->
    <div v-if="isOwner && myRequests.length" class="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t p-3">
      <div class="max-w-screen-md mx-auto">
        <div class="text-xs text-muted-foreground mb-2">Recent join requests</div>
        <div class="space-y-2">
          <div v-for="req in myRequests" :key="req.id" class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <img :src="req.picture || ''" class="h-8 w-8 rounded-md bg-muted object-cover" alt="avatar" />
              <div class="min-w-0">
                <div class="text-sm truncate">{{ req.name || req.pubkey.slice(0,8) }}</div>
                <div class="text-xs text-muted-foreground">{{ new Date(req.createdAt*1000).toLocaleTimeString() }}</div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <Button size="sm" variant="secondary" @click="approveJoin(req.id, req.pubkey)">Approve</Button>
              <Button size="sm" variant="ghost" @click="rejectJoin(req.id)">Reject</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useScoreboardsStore } from '@/stores/scoreboards'
import { useUserStore } from '@/stores/user'
import { MoreVertical, Trash2, QrCode, Copy, Check, Settings } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import QrcodeVue from 'qrcode.vue'
import { useProfilesStore } from '@/stores/profiles'
const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id || ''))

const store = useScoreboardsStore()
const user = useUserStore()
const scoreboard = computed(() => store.items.find((s) => s.id === id.value))

// Wait for store hydration so we don't show a false negative before IndexedDB loads
const ready = ref(false)
onMounted(async () => {
  try { await store.ensureLoaded() } finally { ready.value = true }
})
const notFound = computed(() => ready.value && !scoreboard.value && !!id.value)

const drawerOpen = ref(false)
const inviteOpen = ref(false)
const settingsOpen = ref(false)
const copied = ref(false)
const boardId = computed(() => (id.value ? `lik-${id.value}` : ''))
const LAST_KEY = 'lik:lastScoreboardId'
const CLIPBOARD_KEY = 'lik:lastCopiedBoardId'

// Remember last open scoreboard
watch(
  id,
  (val) => {
    if (!val) return
    try { localStorage.setItem(LAST_KEY, val) } catch {}
  },
  { immediate: true }
)
function openConfirm() {
  drawerOpen.value = true
}
function openInvite() {
  inviteOpen.value = true
}
function openSettings() {
  settingsOpen.value = true
}
async function confirmDelete() {
  if (!id.value) return
  await store.deleteScoreboard(id.value)
  drawerOpen.value = false
  // Navigate away after delete. If there are others, go to the latest, else go to create page
  if (store.items.length) {
    const last = store.items[store.items.length - 1]
    router.replace({ name: 'scoreboard', params: { id: last.id } })
  } else {
    router.replace({ name: 'new-scoreboard' })
  }
}

async function copyBoardId() {
  try {
    if (!boardId.value) return
    await navigator.clipboard.writeText(boardId.value)
    copied.value = true
  try { localStorage.setItem(CLIPBOARD_KEY, boardId.value) } catch {}
    setTimeout(() => (copied.value = false), 1500)
  } catch (e) {
    // noop
  }
}

// Owner-only: last 3 join requests real-time UI
const myRequests = computed(() => store.lastRequests[id.value] || [])
const isOwner = computed(() => store.isOwner(id.value, user.getPubKey()))

function approveJoin(reqId: string, pubkey: string) {
  if (!id.value) return
  void store.approve(id.value, reqId, pubkey)
}
function rejectJoin(reqId: string) {
  if (!id.value) return
  void store.reject(id.value, reqId)
}

// profiles store subscriptions are managed globally by the scoreboards store

// Settings data: owner + members
const profiles = useProfilesStore()
const ownerProfile = computed(() => {
  console.log('[profiles] get owner profile for', { id: scoreboard.value?.id, pubkey: scoreboard.value?.authorPubKey })
  const pub = scoreboard.value?.authorPubKey || ''
  console.log('[profiles] get', { pub })
  return pub ? profiles.get(pub) : null
})
const members = computed(() => {
  const list = scoreboard.value?.members || []
  return list
    .filter(Boolean)
    .map((pk) => profiles.get(pk) || { pubkey: pk, name: '', picture: '', updatedAt: 0 })
})

function short(pk: string) { return (pk || '').slice(0, 8) }

function goCreate() {
  router.push({ name: 'new-scoreboard' })
}
</script>
