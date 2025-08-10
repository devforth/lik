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
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useScoreboardsStore } from '@/stores/scoreboards'
import { ChevronDownCircle, MoreVertical, Trash2 } from 'lucide-vue-next'
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
const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id || ''))

const store = useScoreboardsStore()
const scoreboard = computed(() => store.items.find((s) => s.id === id.value))

const drawerOpen = ref(false)
function openConfirm() {
  drawerOpen.value = true
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
</script>
