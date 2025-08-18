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
                        class="h-5 w-5"
                        :class="{ 'bg-primary text-primary-foreground border-primary': hasPriority(cat.key, p.id) }"
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
    <Drawer v-model:open="drawerOpen">
      <DrawerContent>
        <div class="mx-auto w-full max-w-sm">
          <DrawerHeader>
            <DrawerTitle>Delete scoreboard?</DrawerTitle>
            <DrawerDescription>
              Are you sure you want to delete this scoreboard? If it exists for other editors, they have to delete it by themselves.
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
              Ask the invited user to open the LIK app, tap "Join to scoreboard" in the sidebar, then scan this QR code or paste the code above.
            </div>
            <div class="w-full text-left text-xs text-muted-foreground">
              Note: scanning grants read-only access. You'll get a popup to approve editing rights.
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

    <!-- Logs drawer -->
    <Drawer v-model:open="logsOpen">
      <DrawerContent>
        <div class="mx-auto w-full max-w-md max-h-[66vh] flex flex-col">
          <DrawerHeader class="shrink-0">
            <DrawerTitle>Activity log</DrawerTitle>
            <DrawerDescription>Last edits</DrawerDescription>
          </DrawerHeader>

          <div class="px-4 pb-4 space-y-3 flex-1 overflow-y-auto min-h-0" v-if="logsOpen">
            <div v-if="!logList.length" class="text-sm text-muted-foreground">No activity yet.</div>
            <div v-for="e in logList" :key="e[0]" class="flex items-start gap-3">
              <img :src="eAvatar(e[1])" class="h-8 w-8 rounded-md bg-muted object-cover" alt="avatar" />
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium truncate">{{ eName(e[1]) }}</div>
                <div class="text-xs text-muted-foreground">{{ relTime(e[2]) }}</div>
                <div class="text-sm mt-1">
                  <span v-if="e[4] === '+1'">+1</span>
                  <span v-else-if="e[4] === '-1'">-1</span>
                  <span v-else-if="e[4] === 'add-cat'">Added category</span>
                  <span v-else-if="e[4] === 'prio'">Star</span>
                  <span v-else-if="e[4] === 'unprio'">Unstar</span>
                  <template v-if="e[5]">
                    <span class="text-muted-foreground"> for </span>
                    <span>{{ participantName(e[5] || '') }}</span>
                  </template>
                  <span class="text-muted-foreground"> in </span>
                  <span>"{{ categoryName(e[3]) }}"</span>
                </div>
              </div>
            </div>
          </div>

          <DrawerFooter class="shrink-0">
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
            <DrawerDescription>Owner and editors</DrawerDescription>
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
              <div class="text-xs text-muted-foreground mb-2">Editors ({{ members.length }})</div>
              <div v-if="members.length" class="space-y-2">
                <div v-for="m in members" :key="m.pubkey" class="flex items-center gap-3">
                  <img :src="m.picture || ''" class="h-8 w-8 rounded-md bg-muted object-cover" alt="avatar" />
                  <div class="min-w-0">
                    <div class="text-sm truncate">{{ m.name || short(m.pubkey) }}</div>
                  </div>
                </div>
              </div>
              <div v-else class="text-sm text-muted-foreground">No editors yet</div>
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
  <Drawer v-model:open="createOpen">
    <DrawerContent>
      <div class="mx-auto w-full max-w-sm">
        <DrawerHeader>
          <DrawerTitle>New category</DrawerTitle>
          <DrawerDescription>Enter a name and create a category.</DrawerDescription>
        </DrawerHeader>

        <form class="px-4 pb-2 space-y-4" @submit.prevent="createCategory">
          <div class="space-y-2">
            <label class="text-sm" for="category-name">Category name</label>
            <Input id="category-name" v-model="newCategoryName" placeholder="e.g., Bugs fixed" ref="createInputRef" />
          </div>
        </form>

        <DrawerFooter>
          <Button :disabled="!newCategoryName.trim()" @click="createCategory">Create</Button>
          <DrawerClose as-child>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>

  <!-- Rename category drawer -->
  <Drawer v-model:open="renameOpen">
    <DrawerContent>
      <div class="mx-auto w-full max-w-sm">
        <DrawerHeader>
          <DrawerTitle>Rename category</DrawerTitle>
          <DrawerDescription>Update the category name.</DrawerDescription>
        </DrawerHeader>

        <form class="px-4 pb-2 space-y-4" @submit.prevent="renameCategory">
          <div class="space-y-2">
            <label class="text-sm" for="rename-category-name">Category name</label>
            <Input id="rename-category-name" v-model="renameCategoryName" placeholder="Category name" ref="renameInputRef" />
          </div>
        </form>

        <DrawerFooter>
          <Button :disabled="!renameCategoryName.trim()" @click="renameCategory">Save</Button>
          <DrawerClose as-child>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>

  <!-- Add participant drawer -->
  <Drawer v-model:open="addPartOpen">
    <DrawerContent>
      <div class="mx-auto w-full max-w-sm">
        <DrawerHeader>
          <DrawerTitle>Add participant</DrawerTitle>
          <DrawerDescription>Create a participant name.</DrawerDescription>
        </DrawerHeader>
        <form class="px-4 pb-2 space-y-4" @submit.prevent="addParticipant">
          <div class="space-y-2">
            <label class="text-sm" for="participant-name">Name</label>
            <Input id="participant-name" v-model="newPartName" placeholder="e.g., Carol" ref="addPartInputRef" />
          </div>
        </form>
        <DrawerFooter>
          <Button :disabled="!newPartName.trim()" @click="addParticipant">Add</Button>
          <DrawerClose as-child>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>

  <!-- Rename participant drawer -->
  <Drawer v-model:open="renamePartOpen">
    <DrawerContent>
      <div class="mx-auto w-full max-w-sm">
        <DrawerHeader>
          <DrawerTitle>Rename participant</DrawerTitle>
          <DrawerDescription>Update the participant name.</DrawerDescription>
        </DrawerHeader>
        <form class="px-4 pb-2 space-y-4" @submit.prevent="renameParticipant">
          <div class="space-y-2">
            <label class="text-sm" for="rename-participant-name">Name</label>
            <Input id="rename-participant-name" v-model="renamePartName" placeholder="Name" ref="renamePartInputRef" />
          </div>
        </form>
        <DrawerFooter>
          <Button :disabled="!renamePartName.trim()" @click="renameParticipant">Save</Button>
          <DrawerClose as-child>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>

  <!-- Delete participant confirm drawer -->
  <Drawer v-model:open="deletePartOpen">
    <DrawerContent>
      <div class="mx-auto w-full max-w-sm">
        <DrawerHeader>
          <DrawerTitle>Delete participant?</DrawerTitle>
          <DrawerDescription>
            Deleting participant "{{ deletePartName }}" will remove all their scores from all categories. This cannot be undone.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button variant="destructive" @click="confirmDeleteParticipant">Yes, delete</Button>
          <DrawerClose as-child>
            <Button variant="outline">No, keep</Button>
          </DrawerClose>
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useScoreboardsStore } from '@/stores/scoreboards'
import { useUserStore } from '@/stores/user'
import { MoreVertical, Trash2, QrCode, Copy, Check, Settings, Plus, ChevronUp, ChevronDown, Star } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
import { removeParticipantData as removeParticipantDataCRDT } from '@/nostrToCRDT'
import shortId from '@/lib/utils'
import { 
  addCategory as addCategoryCRDT, 
  addScore as addScoreCRDT, 
  editCat as editCatCRDT, 
  setPriority as setPriorityCRDT, clearPriority as clearPriorityCRDT, setOrder as setOrderCRDT 
} from '@/nostrToCRDT'

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
const newCategoryName = ref('')
const createInputRef = ref<any>(null)

// Rename category drawer state
const renameOpen = ref(false)
const renameCategoryId = ref('')
const renameCategoryName = ref('')
const renameInputRef = ref<any>(null)

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
  newPartName.value = ''
  addPartOpen.value = true
}
function openCreateCategory() {
  newCategoryName.value = ''
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

// Create category action
function createCategory() {
  const name = newCategoryName.value.trim()
  if (!id.value || !name) return
  const cid = shortId()
  addCategoryCRDT(id.value, cid, name)
  createOpen.value = false
  newCategoryName.value = ''
 
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
  const curOrder = Number(current.value?.order ?? 0)
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
  if (!id.value) return
  if (unsubCRDT) { try { unsubCRDT() } catch {}; unsubCRDT = null }
  store.subscribeBoardCRDT(id.value)
  unsubCRDT = () => store.unsubscribeBoardCRDT(id.value)
}

onMounted(() => {
  subscribeBoardMetaIfNeeded()
  subscribeBoardCRDT()
  // Resubscribe CRDT on network reconnect to refresh state
  window.addEventListener('online', subscribeBoardCRDT)
})

onBeforeUnmount(() => {
  if (unsubCRDT) { try { unsubCRDT() } catch {}; unsubCRDT = null }
  if (unsubBRD) { try { unsubBRD() } catch {}; unsubBRD = null }
  window.removeEventListener('online', subscribeBoardCRDT)
})

onBeforeUnmount(() => {
  if (unsubCRDT) { try { unsubCRDT() } catch {}; unsubCRDT = null }
  if (unsubBRD) { try { unsubBRD() } catch {}; unsubBRD = null }
})

// Autofocus the category input when the drawer opens
watch(createOpen, (open) => {
  if (open) {
    nextTick(() => {
      if (createInputRef.value?.focus) {
        createInputRef.value.focus()
      } else if (createInputRef.value?.el?.focus) {
        createInputRef.value.el.focus()
      }
    })
  }
})

// Autofocus the rename input when the drawer opens
watch(renameOpen, (open) => {
  if (open) {
    nextTick(() => {
      if (renameInputRef.value?.focus) {
        renameInputRef.value.focus()
      } else if (renameInputRef.value?.el?.focus) {
        renameInputRef.value.el.focus()
      }
    })
  }
})

// Participants UI state and actions
const addPartOpen = ref(false)
const newPartName = ref('')
const addPartInputRef = ref<any>(null)
const renamePartOpen = ref(false)
const renamePartId = ref('')
const renamePartName = ref('')
const renamePartInputRef = ref<any>(null)
const deletePartOpen = ref(false)
const deletePartId = ref('')
const deletePartName = ref('')

function addParticipant() {
  if (!id.value) return
  const name = newPartName.value.trim()
  if (!name) return
  try {
    if (!scoreboard.value) return
    const next = [...(scoreboard.value.participants || [])]
    const newId = (crypto.randomUUID().slice(0, 6))
    next.push({ id: newId, name })
    scoreboard.value.participants = next
    void store.ensureBoardPREPublished(id.value, 'add participant')
    // owner publishes updated board metadata with participants
    // persisted by store watcher
    addPartOpen.value = false
    newPartName.value = ''
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

// Autofocus handlers for participant drawers
watch(addPartOpen, (open) => {
  if (open) {
    nextTick(() => {
      if (addPartInputRef.value?.focus) addPartInputRef.value.focus()
      else if (addPartInputRef.value?.el?.focus) addPartInputRef.value.el.focus()
    })
  }
})
watch(renamePartOpen, (open) => {
  if (open) {
    nextTick(() => {
      if (renamePartInputRef.value?.focus) renamePartInputRef.value.focus()
      else if (renamePartInputRef.value?.el?.focus) renamePartInputRef.value.el.focus()
    })
  }
})
</script>
