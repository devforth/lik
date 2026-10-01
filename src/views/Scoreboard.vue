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
  <div v-else-if="ready && scoreboard" class="px-4 pt-1 pb-24 space-y-4">
    <!-- Board title, sync status and menu live in the app's top bar -->
    <Teleport defer to="#board-bar">
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-lg font-bold">{{ scoreboard.name }}</h1>
        <div v-if="!canEdit" class="text-xs text-muted-foreground">Read-only</div>
      </div>
      <SyncIndicator />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon" class="size-11">
            <MoreVertical class="size-5" />
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
    </Teleport>

    <!-- Categories: one tile per participant -->
    <section v-for="cat in categoriesList" :key="cat.key" class="space-y-2">
      <div class="flex h-8 items-center justify-between">
        <h2 class="text-base font-bold">{{ cat.value.name || 'Untitled category' }}</h2>
        <DropdownMenu v-if="canEdit">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" class="size-9 text-muted-foreground">
              <MoreHorizontal class="size-[18px]" />
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
            <DropdownMenuItem variant="destructive" @click="openDeleteCategory(cat.key, cat.value.name || '')">
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div class="grid grid-cols-2 gap-2.5">
        <div
          v-for="t in tilesFor(cat.key)"
          :key="t.p.id + ':' + cat.key"
          class="flex flex-col gap-1.5 rounded-[22px] p-3"
          :class="t.style.tile"
        >
          <div class="flex h-6 items-center justify-between">
            <DropdownMenu v-if="isOwner">
              <DropdownMenuTrigger class="truncate text-[13px] font-semibold">{{ t.p.name }}</DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="w-40">
                <DropdownMenuItem @click="openRenameParticipant(t.p.id, t.p.name)">Rename</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" @click="openDeleteParticipant(t.p.id, t.p.name)">Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span v-else class="truncate text-[13px] font-semibold">{{ t.p.name }}</span>
            <button
              class="-mr-2.5 flex size-10 items-center justify-center disabled:opacity-50"
              :disabled="!canEdit"
              aria-label="Toggle priority"
              @click="togglePriority(cat.key, t.p.id)"
            >
              <Star :class="t.style.star" :fill="t.starred ? 'currentColor' : 'none'" />
            </button>
          </div>
          <div class="flex items-start gap-1">
            <span class="text-4xl leading-none font-extrabold tabular-nums">{{ scoreFor(cat.value, t.p.id) }}</span>
            <span v-if="isCellUnsent(cat.key, t.p.id)" class="size-2 rounded-full bg-amber-600">
              <span class="sr-only">not sent yet</span>
            </span>
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              class="flex h-10 items-center justify-center rounded-full disabled:opacity-50"
              :class="t.style.down"
              :disabled="!canEdit"
              aria-label="Decrement"
              @click="changeScore(cat.key, t.p.id, -1)"
            ><ChevronDown class="size-5" :stroke-width="2.5" /></button>
            <button
              class="flex h-10 items-center justify-center rounded-full disabled:opacity-50"
              :class="t.style.up"
              :disabled="!canEdit"
              aria-label="Increment"
              @click="changeScore(cat.key, t.p.id, 1)"
            ><ChevronUp class="size-5" :stroke-width="2.5" /></button>
          </div>
        </div>
      </div>
    </section>

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
  <div v-else class="px-4 pt-1 space-y-4">
    <div v-for="i in 2" :key="i" class="space-y-2">
      <Skeleton class="h-6 w-28" />
      <div class="grid grid-cols-2 gap-2.5">
        <Skeleton class="h-[132px] rounded-[22px]" />
        <Skeleton class="h-[132px] rounded-[22px]" />
      </div>
    </div>
  </div>

  <!-- Bottom bar: activity from other editors, random pick, add category -->
  <div
    v-if="!notFound"
    class="fixed inset-x-4 z-40 flex items-center gap-2.5"
    :class="isOwner && myRequests.length ? 'bottom-28' : 'bottom-6'"
  >
    <button
      v-if="notify.current"
      class="h-12 min-w-0 flex-1 truncate rounded-2xl bg-primary px-3.5 text-left text-[13px] text-primary-foreground"
      @click="notify.dismiss()"
    >{{ notify.current.message }}</button>
    <div class="ml-auto flex gap-2.5">
      <button
        v-if="participants.length"
        class="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"
        aria-label="Pick someone at random"
        @click="rollPick"
      >
        <Dices class="size-6" />
      </button>
      <button
        v-if="canEdit"
        class="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"
        aria-label="Add category"
        @click="openCreateCategory"
      >
        <Plus class="size-6" />
      </button>
    </div>
  </div>

  <!-- Random pick result, over the board; a tap anywhere closes it -->
  <button v-if="pick.open" class="fixed inset-0 z-50 cursor-default" aria-label="Close" @click="closePick"></button>
  <div
    role="status"
    aria-live="polite"
    class="pointer-events-none fixed top-16 left-1/2 z-50 w-56 -translate-x-1/2 rounded-[22px] bg-background shadow-[0_18px_40px_rgba(24,24,27,0.22)] transition duration-200 ease-out"
    :class="pick.open ? (pick.landed ? 'scale-105' : '') : '-translate-y-6 scale-95 opacity-0'"
  >
    <div class="rounded-[22px] px-4 pt-3.5 pb-4 text-center" :class="tileColor(pick.idx).tile">
      <div class="text-xs font-bold tracking-wider uppercase opacity-75">{{ pick.landed ? 'Picked' : 'Picking…' }}</div>
      <div class="mt-1 truncate text-[32px] leading-tight font-extrabold">{{ participants[pick.idx]?.name }}</div>
    </div>
  </div>

  <!-- Create category drawer -->
  <CreateCategory v-model:open="createOpen" @create="onCreateCategory" />

  <!-- Rename category drawer -->
  <RenameCategory v-model:open="renameOpen" v-model="renameCategoryName" @rename="renameCategory" />

  <!-- Delete category confirmation drawer -->
  <div v-if="deleteCatOpen" class="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/30">
    <div class="bg-background w-full sm:max-w-sm rounded-t-lg sm:rounded-lg p-4 space-y-4 shadow-lg">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold">Delete category</h2>
        <p class="text-sm text-muted-foreground">Delete <span class="font-medium">{{ deleteCatName || 'this category' }}</span>? Scores under it will be lost. This action cannot be undone.</p>
      </div>
      <div class="flex gap-2 justify-end">
        <Button variant="outline" @click="deleteCatOpen = false">Cancel</Button>
        <Button variant="destructive" @click="confirmDeleteCategory">Delete</Button>
      </div>
    </div>
  </div>

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
import { MoreVertical, MoreHorizontal, Trash2, QrCode, Settings, Plus, Star, ChevronUp, ChevronDown, Dices } from '@lucide/vue'
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
import shortId, { secureRandomIndex } from '@/lib/utils'
import { 
  addCategory as addCategoryCRDT, 
  addScore as addScoreCRDT, 
  editCat as editCatCRDT, 
  deleteCategory as deleteCategoryCRDT,
  setPriority as setPriorityCRDT, clearPriority as clearPriorityCRDT, setOrder as setOrderCRDT 
} from '@/nostrToCRDT'
import { Capacitor } from '@capacitor/core'
import { useBackupReminderStore } from '@/stores/backupReminder'
import { useLogNotifyStore } from '@/stores/logNotify'
import { useSyncStore } from '@/stores/sync'
import SyncIndicator from '@/components/SyncIndicator.vue'

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
// Delete category confirmation state
const deleteCatOpen = ref(false)
const deleteCatId = ref('')
const deleteCatName = ref('')
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
// When navigating between boards in the same view, republish CRDT for the new board
watch(id, async (val, oldVal) => {
  if (!val || val === oldVal) return
  try {
    await store.ensureLoaded()
    if (scoreboard.value) {
      await (store as any).republishCRDT?.(val)
    }
  } catch {}
})
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
function openDeleteCategory(cid: string, currentName: string) {
  deleteCatId.value = cid
  deleteCatName.value = currentName
  deleteCatOpen.value = true
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

async function approveJoin(reqId: string, pubkey: string) {
  if (!id.value) return
  // Approve join request in the store (updates editors list and republishes PRE)
  await store.approve(id.value, reqId, pubkey)
  // Explicitly (re)subscribe to CRDT after approval as requested
  try { store.subscribeBoardCRDT(id.value) } catch {}
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
function confirmDeleteCategory() {
  if (!id.value || !deleteCatId.value) return
  try { deleteCategoryCRDT(id.value, deleteCatId.value) } catch {}
  deleteCatOpen.value = false
  deleteCatId.value = ''
  deleteCatName.value = ''
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

// Short relative time for notifications: s/m/h/yesterday/d
function timeAgoShort(tsSec: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = Math.max(0, now - (Number(tsSec) || 0))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 172800) return 'yesterday'
  return `${Math.floor(diff / 86400)}d ago`
}

// Top-of-screen notifications for logs from other editors
const notify = useLogNotifyStore()
const lastSeenLogId = ref<string | null>(null)
const lastSeenTs = ref<number>(0)
const myPubKey = computed(() => useUserStore().getPubKey() || '')

function formatLogMessage(e: [string, string, number, string, string, string | null]): string {
  const [, pub, ts, cid, action, pid] = e
  const who = eName(pub)
  const cat = categoryName(cid)
  const ago = timeAgoShort(Number(ts))
  if (/^\+[0-9]+$/.test(action) || /^-[0-9]+$/.test(action)) {
    const s = action
    const forPart = pid ? ` • ${participantName(pid)}` : ''
    return `${who} ${s}${forPart} in "${cat}" • ${ago}`
  }
  if (action === 'add-cat') return `${who} added category "${cat}" • ${ago}`
  if (action === 'prio') return `${who} starred ${participantName(String(pid || ''))} in "${cat}" • ${ago}`
  if (action === 'unprio') return `${who} unstarred ${participantName(String(pid || ''))} in "${cat}" • ${ago}`
  return `${who} updated "${cat}" • ${ago}`
}

// Watch the snapshot events ascending (as stored), enqueue unseen remote logs oldest-first
watch(
  () => (scoreboard.value?.snapshot?.events || []) as [string, string, number, string, string, string | null][],
  (events) => {
    if (!Array.isArray(events) || !events.length) return
    const me = myPubKey.value
    // Find new events after last seen id; maintain a simple marker by id or fallback to time
    const existingIdx = lastSeenLogId.value ? events.findIndex((e) => String(e?.[0]) === lastSeenLogId.value) : -1
    let newList = [] as [string, string, number, string, string, string | null][]
    if (existingIdx === -1) {
      if (lastSeenLogId.value) {
        // Marker missing (trim or rebase). Use timestamp guard to avoid spamming old ones
        newList = events.filter((e) => Number(e?.[2] || 0) > (lastSeenTs.value || 0))
      } else {
        // First run: don't notify existing history
        newList = []
      }
    } else {
      newList = events.slice(existingIdx + 1)
    }
    // Filter remote only (exclude my own)
    const remote = newList.filter((e) => String(e?.[1] || '') && String(e[1]) !== me)
    if (!remote.length) {
      // Update last seen to latest
      const last = events[events.length - 1]
      lastSeenLogId.value = String(last?.[0] || lastSeenLogId.value || '')
      lastSeenTs.value = Number(last?.[2] || lastSeenTs.value || 0)
      return
    }
    // Enqueue oldest first to satisfy order
    for (const e of remote) {
      const message = formatLogMessage(e)
      notify.enqueue({ message, durationMs: 5000 })
    }
    // Advance marker to latest
    const last = events[events.length - 1]
    lastSeenLogId.value = String(last?.[0] || lastSeenLogId.value || '')
    lastSeenTs.value = Number(last?.[2] || lastSeenTs.value || 0)
  },
  { deep: false }
)

// Initialize markers to current latest on mount and when switching boards
onMounted(() => {
  const evts = (scoreboard.value?.snapshot?.events || []) as [string, string, number, string, string, string | null][]
  if (evts.length) {
    const last = evts[evts.length - 1]
    lastSeenLogId.value = String(last?.[0] || '')
    lastSeenTs.value = Number(last?.[2] || 0)
  }
})
watch(id, () => {
  const evts = (scoreboard.value?.snapshot?.events || []) as [string, string, number, string, string, string | null][]
  if (evts.length) {
    const last = evts[evts.length - 1]
    lastSeenLogId.value = String(last?.[0] || '')
    lastSeenTs.value = Number(last?.[2] || 0)
  } else {
    lastSeenLogId.value = null
    lastSeenTs.value = 0
  }
})

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

// Cells whose score or star has not reached the relays; marked only once sending is overdue, not on every tap
const sync = useSyncStore()
const syncStatus = computed(() => sync.statusFor(id.value))
function isCellUnsent(categoryKey: string, participantId: string): boolean {
  const s = syncStatus.value
  if (!s || (s.state !== 'pending' && s.state !== 'offline')) return false
  return s.cells.has(`${categoryKey}|${participantId}`)
}

// Tile colors by participant position: soft tile, solid (starred tile and the up button), and
// the inverse used on a solid tile. Ink on tint keeps text contrast >= 4.5:1 in both themes.
const TILE_COLORS = [
  { tile: 'bg-orange-100 text-orange-800 dark:bg-orange-400/15 dark:text-orange-300', solid: 'bg-orange-800 text-white dark:bg-orange-300 dark:text-orange-950', onSolid: 'bg-white text-orange-800 dark:bg-orange-950 dark:text-orange-300' },
  { tile: 'bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-300', solid: 'bg-sky-800 text-white dark:bg-sky-300 dark:text-sky-950', onSolid: 'bg-white text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  { tile: 'bg-green-100 text-green-800 dark:bg-green-400/15 dark:text-green-300', solid: 'bg-green-800 text-white dark:bg-green-300 dark:text-green-950', onSolid: 'bg-white text-green-800 dark:bg-green-950 dark:text-green-300' },
  { tile: 'bg-purple-100 text-purple-800 dark:bg-purple-400/15 dark:text-purple-300', solid: 'bg-purple-800 text-white dark:bg-purple-300 dark:text-purple-950', onSolid: 'bg-white text-purple-800 dark:bg-purple-950 dark:text-purple-300' },
  { tile: 'bg-pink-100 text-pink-800 dark:bg-pink-400/15 dark:text-pink-300', solid: 'bg-pink-800 text-white dark:bg-pink-300 dark:text-pink-950', onSolid: 'bg-white text-pink-800 dark:bg-pink-950 dark:text-pink-300' },
  { tile: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-400/15 dark:text-yellow-300', solid: 'bg-yellow-800 text-white dark:bg-yellow-300 dark:text-yellow-950', onSolid: 'bg-white text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300' },
]
function tileColor(index: number) {
  return TILE_COLORS[index % TILE_COLORS.length]
}

// The starred tile of a category turns solid so it stands out
function tilesFor(categoryKey: string) {
  return participants.value.map((p, i) => {
    const c = tileColor(i)
    const starred = hasPriority(categoryKey, p.id)
    const style = starred
      ? { tile: c.solid, star: 'size-6 text-amber-300 dark:text-inherit', down: 'bg-white/20 dark:bg-black/15', up: c.onSolid }
      : { tile: c.tile, star: 'size-[22px]', down: 'bg-white/70 dark:bg-white/10', up: c.solid }
    return { p, starred, style }
  })
}

// Random pick: one participant, each with probability 1/N; names spin ~700 ms, each step ~20% slower
const SPIN_MS = [12, 14, 17, 21, 25, 30, 36, 43, 52, 62, 74, 89, 107, 128]
const pick = ref({ open: false, landed: false, idx: 0 })
let pickTimer: ReturnType<typeof setTimeout> | undefined
function rollPick() {
  const n = participants.value.length
  const chosen = secureRandomIndex(n)
  // Start so that the last spin step lands on the chosen one
  const start = (((chosen - SPIN_MS.length) % n) + n) % n
  let step = 0
  clearTimeout(pickTimer)
  pick.value = { open: true, landed: false, idx: start }
  const next = () => {
    if (step === SPIN_MS.length) {
      pick.value.landed = true
      return
    }
    pickTimer = setTimeout(() => {
      step++
      pick.value.idx = (start + step) % n
      next()
    }, SPIN_MS[step])
  }
  next()
}
function closePick() {
  clearTimeout(pickTimer)
  pick.value.open = false
}

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
  if (!scoreboard.value || !id.value) {
    console.error('[scoreboards] subscribeBoardMetaIfNeeded: missing scoreboard or id')
    return
  }
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

// Helper: count other authors (exclude myself)
const otherAuthorsCount = computed(() => {
  const me = user.getPubKey() || ''
  const eds = Array.isArray(scoreboard.value?.editors) ? scoreboard.value!.editors : []
  return eds.filter((p) => p && p !== me).length
})

function subscribeBoardCRDT() {
  if (!id.value) {
    throw new Error('Board ID is required to subscribe to CRDT')
  }
  // If the scoreboard isn't loaded yet (store not hydrated), skip for now
  if (!scoreboard.value) return
  // Skip when there are no other authors yet; we'll re-run on editors change
  if (otherAuthorsCount.value === 0) return
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

watch(id, async (val, oldVal) => {
  if (!val || val === oldVal) return
  subscribeBoardMetaIfNeeded()
  subscribeBoardCRDT()
})

onMounted(async () => {
  await store.ensureLoaded()
  subscribeBoardMetaIfNeeded()
  subscribeBoardCRDT()
  // Republish latest CRDT snapshot on open to help peers catch up
  try { await store.republishCRDT(id.value) } catch {}
  // Resubscribe CRDT on network reconnect to refresh state
  window.addEventListener('online', subscribeBoardCRDT)
  // Handle resume from background (Capacitor) and web visibility change
  const onBecameActive = () => {
    // Always resubscribe CRDT
    subscribeBoardCRDT()
    // If not owner, also (re)subscribe to board metadata channel
    subscribeBoardMetaIfNeeded()
    // Republish snapshot on resume for fast convergence
    try { void store.republishCRDT(id.value) } catch {}
  }
  // Web fallback
  onVis = () => { if (document.visibilityState === 'visible') onBecameActive() }
  document.addEventListener('visibilitychange', onVis)
  // Capacitor dispatches a document 'resume' event when the Android activity resumes
  if (Capacitor?.isNativePlatform?.()) {
    document.addEventListener('resume', onBecameActive)
    capRemove = () => document.removeEventListener('resume', onBecameActive)
  }
})

onBeforeUnmount(() => {
  clearTimeout(pickTimer)
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
