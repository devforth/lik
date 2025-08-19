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

  <!-- Loaded state -->
  <div v-else-if="ready && scoreboard" class="p-4 space-y-6">
    <div class="flex items-start justify-between gap-2">
      <div>
        <h1 class="text-2xl font-semibold">{{ scoreboard?.name ?? 'Scoreboard' }}</h1>
        <div v-if="ready && !canEdit" class="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground">
          <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
          Read-only
        </div>
      </div>

      <!-- Actions: kebab menu -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon" class="h-8 w-8">
            <MoreVertical class="h-5 w-5" />
            <span class="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-52">
          <DropdownMenuItem @click="openLog()">
            <Settings class="h-4 w-4" />
            <span>Log</span>
          </DropdownMenuItem>
          <DropdownMenuItem @click="openSettings()">
            <Settings class="h-4 w-4" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuItem @click="openInvite()">
            <QrCode class="h-4 w-4" />
            <span>Invite to board</span>
          </DropdownMenuItem>
          <DropdownMenuItem v-if="isOwner" @click="openAddParticipant()">
            <Plus class="h-4 w-4" />
            <span>Add participant</span>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" @click="openConfirm()">
            <Trash2 class="h-4 w-4" />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- Scoreboard table -->
    <div v-if="scoreboard" class="-mx-4 px-4">
      <div class="overflow-x-auto relative">
        <table class="w-full border-collapse table-fixed">
          <thead>
            <tr>
              <th
                v-for="p in participants"
                :key="p.id"
                class="px-2 py-2 text-center text-sm font-medium text-foreground border-b"
                :style="{ minWidth: '40vw', width: '40vw' }"
              >
                <div class="flex items-center justify-center gap-2">
                  <div class="truncate max-w-[28vw]">{{ p.name }}</div>
                  <DropdownMenu v-if="isOwner">
                    <DropdownMenuTrigger as-child>
                      <Button variant="ghost" size="icon" class="h-7 w-7">
                        <MoreVertical class="h-4 w-4" />
                        <span class="sr-only">Open participant menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-40">
                      <DropdownMenuItem @click="openRenameParticipant(p.id, p.name)">Rename</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" @click="openDeleteParticipant(p.id, p.name)">Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="cat in categoriesList" :key="cat.key">
              <!-- Category name row -->
              <tr>
                <td :colspan="Math.min(2, participants.length)" class="pt-2 pb-1">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-sm font-semibold">{{ cat.value.name || 'Untitled category' }}</div>
                    <DropdownMenu v-if="canEdit">
                      <DropdownMenuTrigger as-child>
                        <Button variant="ghost" size="icon" class="h-7 w-7">
                          <MoreVertical class="h-4 w-4" />
                          <span class="sr-only">Open category menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" class="w-40">
                        <DropdownMenuItem @click="openRenameCategory(cat.key, cat.value.name || '')">
                          <span>Rename</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem :disabled="!canMoveCategoryUp(cat.key)" @click="moveCategoryUp(cat.key)">
                          <span>Move category up</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </td>
              </tr>
              <!-- Counters row -->
              <tr>
                <td v-for="p in participants" :key="p.id + ':' + cat.key" class="pb-4" :style="{ minWidth: '40vw', width: '40vw' }">
                  <div class="flex flex-col items-center justify-center gap-2">
                    <div class="flex items-center justify-center gap-3">
                      <Button variant="outline" size="icon" class="h-8 w-8" :disabled="!canEdit" @click="changeScore(cat.key, p.id, -1)" aria-label="Decrement">
                        <ChevronDown class="h-4 w-4" />
                      </Button>
                      <div class="min-w-[3ch] text-center tabular-nums">{{ scoreFor(cat.value, p.id) }}</div>
                      <Button variant="outline" size="icon" class="h-8 w-8" :disabled="!canEdit" @click="changeScore(cat.key, p.id, 1)" aria-label="Increment">
                        <ChevronUp class="h-4 w-4" />
                      </Button>
                    </div>
                    <!-- Priority toggle: star button below the score with debug number -->
                    <div class="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        class="h-5 w-5 focus-visible:ring-0 focus-visible:ring-transparent focus-visible:border-inherit hover:transition-none"
                        :class="hasPriority(cat.key, p.id)
                          ? 'bg-primary text-primary-foreground border-primary hover:bg-primary hover:text-primary-foreground dark:bg-primary/30 dark:text-white dark:border-primary/40 dark:hover:bg-primary/40 dark:hover:text-white'
                          : ''"
                        :disabled="!canEdit"
                        @click="togglePriority(cat.key, p.id)"
                        aria-label="Toggle priority"
                      >
                        <Star class="h-2 w-2" :fill="hasPriority(cat.key, p.id) ? 'currentColor' : 'none'" />
                      </Button>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>



  <!-- Confirm delete drawer -->
  <ConfirmDeleteBoard v-model:open="drawerOpen" @confirm="confirmDelete" />

  <!-- Invite drawer -->
  <Invite v-model:open="inviteOpen" :board-id="boardId" :copied="copied" @copy="copyBoardId" />

  <!-- Logs drawer -->
  <Logs v-model:open="logsOpen" :log-list="logList" :e-name="eName" :e-avatar="eAvatar" :rel-time="relTime" :participant-name="participantName" :category-name="categoryName" />

  <!-- Settings drawer: owner and members list -->
  <SettingsDrawer v-model:open="settingsOpen" :owner-profile="ownerProfile" :members="members" :short="short" />

    <!-- Owner: last 3 join requests -->
    <div v-if="isOwner && myRequests.length" class="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t p-3">
      <div class="max-w-screen-md mx-auto">
        <div class="text-xs text-muted-foreground mb-2">Requests to edit scoreboard</div>
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

  <!-- Loading skeleton state -->
  <div v-else class="p-4 space-y-6">
    <div class="flex items-start justify-between gap-2">
      <div class="space-y-2 w-full max-w-screen-sm">
        <Skeleton class="h-7 w-40" />
        <Skeleton class="h-4 w-24" />
      </div>
      <Skeleton class="h-8 w-8 rounded-md" />
    </div>

    <div class="-mx-4 px-4">
      <div class="overflow-x-auto relative">
        <div class="min-w-full space-y-4">
          <!-- Header row skeleton -->
          <div class="flex gap-4">
            <Skeleton class="h-6 w-[40vw]" />
            <Skeleton class="h-6 w-[40vw]" />
          </div>
          <!-- A few rows skeleton -->
          <div class="space-y-3">
            <div v-for="i in 3" :key="i" class="flex gap-4 items-center">
              <Skeleton class="h-10 w-[40vw]" />
              <Skeleton class="h-10 w-[40vw]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Floating create-category action -->
  <div v-if="!notFound && canEdit" class="pointer-events-none">
    <Button
      variant="default"
      size="icon"
      class="pointer-events-auto fixed right-4 md:right-6 z-50 h-14 w-14 rounded-full shadow-lg"
      :class="{ 'bottom-24': isOwner && myRequests.length, 'bottom-6': !(isOwner && myRequests.length) }"
      aria-label="Add category"
      @click="openCreateCategory"
    >
      <Plus class="h-7 w-7" />
    </Button>
  </div>

  <!-- Create category drawer -->
  <CreateCategory v-model:open="createOpen" @create="onCreateCategory" />

  <!-- Rename category drawer -->
  <RenameCategory v-model:open="renameOpen" v-model="renameCategoryName" @rename="renameCategory" />

  <!-- Add participant drawer -->
  <AddParticipant v-model:open="addPartOpen" @add="onAddParticipant" />

  <!-- Rename participant drawer -->
  <RenameParticipant v-model:open="renamePartOpen" v-model="renamePartName" @rename="renameParticipant" />

  <!-- Delete participant confirm drawer -->
  <DeleteParticipantConfirm v-model:open="deletePartOpen" :name="deletePartName" @confirm="confirmDeleteParticipant" />
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useScoreboardsStore } from '@/stores/scoreboards'
import { useUserStore } from '@/stores/user'
import { MoreVertical, Trash2, QrCode, Settings, Plus, ChevronUp, ChevronDown, Star } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
// Drawer components
import ConfirmDeleteBoard from '@/drawers/ConfirmDeleteBoard.vue'
import Invite from '@/drawers/Invite.vue'
import Logs from '@/drawers/Logs.vue'
import SettingsDrawer from '@/drawers/Settings.vue'
import CreateCategory from '@/drawers/CreateCategory.vue'
import RenameCategory from '@/drawers/RenameCategory.vue'
import AddParticipant from '@/drawers/AddParticipant.vue'
import RenameParticipant from '@/drawers/RenameParticipant.vue'
import DeleteParticipantConfirm from '@/drawers/DeleteParticipantConfirm.vue'
import { useProfilesStore } from '@/stores/profiles'
import { removeParticipantData as removeParticipantDataCRDT } from '@/nostrToCRDT'
import shortId from '@/lib/utils'
import { 
  addCategory as addCategoryCRDT, 
  addScore as addScoreCRDT, 
  editCat as editCatCRDT, 
  setPriority as setPriorityCRDT, clearPriority as clearPriorityCRDT, setOrder as setOrderCRDT 
} from '@/nostrToCRDT'
import { Capacitor } from '@capacitor/core'
import { useBackupReminderStore } from '@/stores/backupReminder'

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id || ''))

const store = useScoreboardsStore()
const user = useUserStore()
const scoreboard = computed(() => store.items.find((s) => s.id === id.value))
const participants = computed(() => scoreboard.value?.participants || [])

// Wait for store hydration so we don't show a false negative before IndexedDB loads
const ready = ref(false)
onMounted(async () => {
  try { await store.ensureLoaded() } finally { ready.value = true }
})
const notFound = computed(() => ready.value && !scoreboard.value && !!id.value)

const drawerOpen = ref(false)
const inviteOpen = ref(false)
const settingsOpen = ref(false)
const logsOpen = ref(false)
const copied = ref(false)
// Invite/share code carries secret: lik::scoreboard_id::secret
const boardId = computed(() => {
  const sb = scoreboard.value
  if (!sb?.id || !sb?.secret) {
    return ''
  }
  return `lik::${sb.id}::${sb.secret}`
})
const LAST_KEY = 'lik:lastScoreboardId'
const CLIPBOARD_KEY = 'lik:lastCopiedBoardId'

// Create category drawer state
const createOpen = ref(false)
// name input handled inside CreateCategory component

// Rename category drawer state
const renameOpen = ref(false)
const renameCategoryId = ref('')
const renameCategoryName = ref('')
// input focus handled inside RenameCategory component

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
function openLog() {
  logsOpen.value = true
}
function openAddParticipant() {
  addPartOpen.value = true
}
function openCreateCategory() {
  createOpen.value = true
}
function openRenameCategory(cid: string, currentName: string) {
  renameCategoryId.value = cid
  renameCategoryName.value = currentName
  renameOpen.value = true
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
const canEdit = computed(() => {
  const me = user.getPubKey() || ''
  const sb = scoreboard.value
  if (!sb || !me) {
    return false
  }
  if (sb.authorPubKey === me) {
    return true
  }
  const list = Array.isArray(sb.editors) ? sb.editors : []
  return list.includes(me)
})

function approveJoin(reqId: string, pubkey: string) {
  if (!id.value) return
  void store.approve(id.value, reqId, pubkey)
}
function rejectJoin(reqId: string) {
  if (!id.value) return
  void store.reject(id.value, reqId)
}

// Create category action (from child component)
function onCreateCategory(name: string) {
  const n = name.trim()
  if (!id.value || !n) return
  const cid = shortId()
  addCategoryCRDT(id.value, cid, n)
  createOpen.value = false
}

// Rename category action
function renameCategory() {
  const name = renameCategoryName.value.trim()
  const cid = renameCategoryId.value
  if (!id.value || !cid || !name) return
  try {
    editCatCRDT(id.value, cid, name)
    renameOpen.value = false
    renameCategoryId.value = ''
    renameCategoryName.value = ''
  } catch (e) {
    // noop
  }
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
  const list = scoreboard.value?.editors || []
  return list
    .filter(Boolean)
    .map((pk) => profiles.get(pk) || { pubkey: pk, name: '', picture: '', updatedAt: 0 })
})

// Logs helpers (lazy render when drawer open) — from CRDT snapshot.events
// CRDT stores events sorted ascending by time; show newest first in UI
const logList = computed(() => {
  if (!logsOpen.value) return []
  const list = (scoreboard.value?.snapshot?.events || []) as [string, string, number, string, string, string | null][]
  return [...list].reverse()
})
function eName(pubkey: string): string {
  const p = profiles.get(pubkey)
  return p?.name || short(pubkey)
}
function eAvatar(pubkey: string): string {
  const p = profiles.get(pubkey)
  return p?.picture || ''
}
function participantName(pid: string): string {
  const list = scoreboard.value?.participants || []
  const found = list.find((p) => p.id === pid)
  return found?.name || pid
}
function categoryName(cid: string): string {
  const cats = (scoreboard.value?.snapshot?.categories || {}) as Record<string, any>
  const c = cats[cid]
  const name = (c && typeof c === 'object') ? (c.name || c?.value?.name || '') : ''
  return String(name || 'Untitled category')
}
function relTime(tsSec: number): string {
  const now = Math.floor(Date.now() / 1000)
  const d = Math.max(0, now - (Number(tsSec) || 0))
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d/60)}m ago`
  if (d < 86400) return `${Math.floor(d/3600)}h ago`
  return `${Math.floor(d/86400)}d ago`
}

// Categories from snapshot, sorted by order desc (higher first) then name, visible only, excluding ::prio shadow categories
const categoriesList = computed(() => {
  const cats = (scoreboard.value?.snapshot?.categories || {}) as Record<string, any>
  return Object.entries(cats)
    .map(([key, value]) => ({ key, value }))
  .filter((c) => (c.value?.vis ?? 1) === 1 && !String(c.key).endsWith('::prio'))
    .sort((a, b) => {
      const ao = Number(a.value?.order ?? 0)
      const bo = Number(b.value?.order ?? 0)
  if (ao !== bo) return bo - ao
      const an = String(a.value?.name || '')
      const bn = String(b.value?.name || '')
      return an.localeCompare(bn)
    })
})

function scoreFor(cat: any, participantId: string): number {
  const p = Number((cat?.state?.P || {})[participantId] || 0)
  const n = Number((cat?.state?.N || {})[participantId] || 0)
  return p - n
}

function changeScore(categoryKey: string, participantId: string, delta: -1 | 1) {
  if (!id.value) return
  addScoreCRDT(id.value, categoryKey, participantId, delta)
  // After a score change, consider prompting backup reminder
  // Precondition: only when editing own scoreboard (owner)
  const brd = scoreboard.value
  if (isOwner.value && brd && typeof brd.createdAt === 'number') {
    const backup = useBackupReminderStore()
    backup.promptIfNeeded(brd.createdAt)
  }
}

// Priority helpers
function prioKeyFor(categoryKey: string) { return `${categoryKey}::prio` }
function hasPriority(categoryKey: string, participantId: string): boolean {
  const prioCat = scoreboard.value?.snapshot?.categories?.[prioKeyFor(categoryKey)]
  if (!prioCat) return false
  const p = Number((prioCat?.state?.P || {})[participantId] || 0)
  const n = Number((prioCat?.state?.N || {})[participantId] || 0)
  return p - n > 0
}

function togglePriority(categoryKey: string, participantId: string) {
  if (!id.value) return
  // Toggle: if already has prio -> clear; else set prio (single selection semantics are handled in setPriority)
  if (hasPriority(categoryKey, participantId)) {
    clearPriorityCRDT(id.value, categoryKey, participantId)
  } else {
    setPriorityCRDT(id.value, categoryKey, participantId)
  }
}

// Category ordering helpers
function canMoveCategoryUp(categoryKey: string): boolean {
  const list = categoriesList.value
  const idx = list.findIndex((c) => c.key === categoryKey)
  // Higher order categories are at top (lower index). Can move up if there's an item above.
  return idx > 0
}

function moveCategoryUp(categoryKey: string) {
  if (!id.value) return
  const list = categoriesList.value
  const idx = list.findIndex((c) => c.key === categoryKey)
  if (idx <= 0) return // nothing above or not found
  const above = list[idx - 1]
  const current = list[idx]
  const aboveOrder = Number(above.value?.order ?? 0)
  // Find the next after above (two above current)
  const twoAbove = idx - 2 >= 0 ? list[idx - 2] : null
  if (!twoAbove) {
    // Only one category exists with higher order -> set its order + 1
    const newOrder = aboveOrder + 1
    setOrderCRDT(id.value, categoryKey, newOrder)
    return
  }
  const twoAboveOrder = Number(twoAbove.value?.order ?? 0)
  // Set to average between above and twoAbove: order = above + (twoAbove - above)/2
  const newOrder = aboveOrder + (twoAboveOrder - aboveOrder) / 2
  setOrderCRDT(id.value, categoryKey, newOrder)
}

function short(pk: string) { return (pk || '').slice(0, 8) }

function goCreate() {
  router.push({ name: 'new-scoreboard' })
}

// Explicit subscriptions/unsubscriptions for board metadata and CRDT
let unsubCRDT: null | (() => void) = null
let unsubBRD: null | (() => void) = null

function subscribeBoardMetaIfNeeded() {
  if (!scoreboard.value || !id.value) return
  if (isOwner.value) {
    // Owner: verify board PRE everywhere
    store.verifyBoardPREEverywhere(id.value)
    if (unsubBRD) { try { unsubBRD() } catch {}; unsubBRD = null }
  } else {
    if (unsubBRD) { try { unsubBRD() } catch {}; unsubBRD = null }
    store.subscribeBoardMeta(id.value, scoreboard.value.authorPubKey)
    unsubBRD = () => store.unsubscribeBoardMeta(id.value)
  }
}

function subscribeBoardCRDT() {
  if (!id.value) {
    throw new Error('Board ID is required to subscribe to CRDT')
  }
  // If the scoreboard isn't loaded yet (store not hydrated), skip for now
  if (!scoreboard.value) return
  if (unsubCRDT) {
    try { unsubCRDT() } catch {}; 
    unsubCRDT = null 
  }
  store.subscribeBoardCRDT(id.value)
  unsubCRDT = () => store.unsubscribeBoardCRDT(id.value)
}

// Keep references for cleanup
let capRemove: undefined | (() => void)
let onVis: undefined | (() => void)

onMounted(async () => {
  await store.ensureLoaded()
  subscribeBoardMetaIfNeeded()
  subscribeBoardCRDT()
  // Resubscribe CRDT on network reconnect to refresh state
  window.addEventListener('online', subscribeBoardCRDT)
  // Handle resume from background (Capacitor) and web visibility change
  const onBecameActive = () => {
    // Always resubscribe CRDT
    subscribeBoardCRDT()
    // If not owner, also (re)subscribe to board metadata channel
    if (!isOwner.value) subscribeBoardMetaIfNeeded()
  }
  // Web fallback
  onVis = () => { if (document.visibilityState === 'visible') onBecameActive() }
  document.addEventListener('visibilitychange', onVis)
  // Capacitor app state
  ;(async () => {
    try {
      if (Capacitor?.isNativePlatform?.()) {
  const capApp = '@capacitor/app'
  const { App } = await import(/* @vite-ignore */ capApp as any)
  const listener = await App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
          if (isActive) onBecameActive()
        })
        capRemove = () => { try { listener.remove() } catch {} }
      }
    } catch {}
  })()
})

onBeforeUnmount(() => {
  if (unsubCRDT) { try { unsubCRDT() } catch {}; unsubCRDT = null }
  if (unsubBRD) { try { unsubBRD() } catch {}; unsubBRD = null }
  window.removeEventListener('online', subscribeBoardCRDT)
  if (onVis) document.removeEventListener('visibilitychange', onVis)
  if (capRemove) { try { capRemove() } catch {} }
})

// (duplicate onBeforeUnmount removed)

// Focus is handled inside drawer components

// Participants UI state and actions
const addPartOpen = ref(false)
const renamePartOpen = ref(false)
const renamePartId = ref('')
const renamePartName = ref('')
const deletePartOpen = ref(false)
const deletePartId = ref('')
const deletePartName = ref('')

function onAddParticipant(name: string) {
  if (!id.value) return
  const n = name.trim()
  if (!n) return
  try {
    if (!scoreboard.value) return
    const next = [...(scoreboard.value.participants || [])]
    const newId = (crypto.randomUUID().slice(0, 6))
    next.push({ id: newId, name: n })
    scoreboard.value.participants = next
    void store.ensureBoardPREPublished(id.value, 'add participant')
    // owner publishes updated board metadata with participants
    // persisted by store watcher
    addPartOpen.value = false
  } catch {}
}

function openRenameParticipant(pid: string, current: string) {
  renamePartId.value = pid
  renamePartName.value = current
  renamePartOpen.value = true
}

async function renameParticipant() {
  if (!id.value || !renamePartId.value) return
  const name = renamePartName.value.trim()
  if (!name) return
  try {
    if (!scoreboard.value) return
    const list = (scoreboard.value.participants || []).map((p) => p.id === renamePartId.value ? { ...p, name } : p)
    scoreboard.value.participants = list
    void store.ensureBoardPREPublished(id.value, 'rename participant')
    renamePartOpen.value = false
    renamePartId.value = ''
    renamePartName.value = ''
  } catch {}
}

function openDeleteParticipant(pid: string, current: string) {
  deletePartId.value = pid
  deletePartName.value = current
  deletePartOpen.value = true
}

async function confirmDeleteParticipant() {
  if (!id.value || !deletePartId.value) return
  try {
    // Remove scores from CRDT snapshot
    removeParticipantDataCRDT(id.value, deletePartId.value)
    // Remove participant from board model
    if (scoreboard.value) {
      scoreboard.value.participants = (scoreboard.value.participants || []).filter((p) => p.id !== deletePartId.value)
      void store.ensureBoardPREPublished(id.value, 'delete participant')
    }
  } finally {
    deletePartOpen.value = false
    deletePartId.value = ''
    deletePartName.value = ''
  }
}

// Autofocus handled inside drawer components
</script>
