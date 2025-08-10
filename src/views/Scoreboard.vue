<template>
  <div class="p-4 space-y-6">
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
              <Input :model-value="boardId" readonly class="font-mono" />
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useScoreboardsStore } from '@/stores/scoreboards'
import { MoreVertical, Trash2, QrCode, Copy, Check } from 'lucide-vue-next'
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
const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id || ''))

const store = useScoreboardsStore()
const scoreboard = computed(() => store.items.find((s) => s.id === id.value))

const drawerOpen = ref(false)
const inviteOpen = ref(false)
const copied = ref(false)
const boardId = computed(() => (id.value ? `lik-${id.value}` : ''))
function openConfirm() {
  drawerOpen.value = true
}
function openInvite() {
  inviteOpen.value = true
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
    setTimeout(() => (copied.value = false), 1500)
  } catch (e) {
    // noop
  }
}
</script>
