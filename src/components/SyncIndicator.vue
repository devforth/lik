<template>
  <div v-if="status" class="ml-auto flex items-center">
    <button
      v-if="status.state === 'pending' || status.state === 'offline'"
      type="button"
      class="inline-flex h-8 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 pl-2.5 pr-3 text-[13px] font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300"
      :aria-label="label"
      @click="open = true"
    >
      <CloudAlert v-if="status.state === 'pending'" class="size-[18px]" />
      <Smartphone v-else class="size-[18px]" />
      <span>{{ label }}</span>
    </button>
    <button
      v-else
      type="button"
      class="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md px-1.5 text-[13px]"
      :class="status.state === 'synced' ? 'text-muted-foreground' : 'text-foreground'"
      :aria-label="label"
      @click="open = true"
    >
      <CloudCheck v-if="status.state === 'synced'" class="size-5" />
      <CloudUpload v-else-if="status.state === 'sending'" class="size-5 animate-pulse" />
      <CloudDownload v-else class="size-5" />
      <span v-if="status.state !== 'synced'" class="text-muted-foreground">{{ label }}</span>
    </button>
    <SyncDetails v-model:open="open" :board-id="boardId" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { CloudAlert, CloudCheck, CloudDownload, CloudUpload, Smartphone } from 'lucide-vue-next'
import { useSyncStore } from '@/stores/sync'
import SyncDetails from '@/drawers/SyncDetails.vue'

const route = useRoute()
const sync = useSyncStore()
const open = ref(false)

const boardId = computed(() => (route.name === 'scoreboard' ? String(route.params.id || '') : ''))
const status = computed(() => (boardId.value ? sync.statusFor(boardId.value) : null))

const label = computed(() => {
  const s = status.value
  if (!s) return ''
  switch (s.state) {
    case 'pending': return s.count ? `Not sent · ${s.count}` : 'Not sent'
    case 'offline': return s.count ? `${s.count} on phone` : 'On phone'
    case 'sending': return 'Sending…'
    case 'checking': return 'Checking…'
    default: return 'Synced'
  }
})
</script>
