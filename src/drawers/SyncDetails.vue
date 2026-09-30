<template>
  <Drawer :open="open" @update:open="(v) => emit('update:open', v)">
    <DrawerContent>
      <div v-if="status" class="mx-auto w-full max-w-md max-h-[80vh] flex flex-col">
        <DrawerHeader class="shrink-0 flex-row items-start gap-3 text-left">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full" :class="iconWrapClass">
            <CloudAlert v-if="status.state === 'pending'" class="size-5" />
            <Smartphone v-else-if="status.state === 'offline'" class="size-5" />
            <CloudUpload v-else-if="status.state === 'sending'" class="size-5 animate-pulse" />
            <CloudDownload v-else-if="status.state === 'checking'" class="size-5" />
            <CloudCheck v-else class="size-5" />
          </div>
          <div class="min-w-0 space-y-1">
            <DrawerTitle>{{ title }}</DrawerTitle>
            <DrawerDescription>{{ description }}</DrawerDescription>
          </div>
        </DrawerHeader>

        <div class="px-4 space-y-4 flex-1 overflow-y-auto min-h-0">
          <div class="border-y text-sm">
            <div v-if="status.canEdit" class="flex items-center justify-between gap-3 py-2.5 border-b border-border/60">
              <span class="text-muted-foreground">Your latest change</span>
              <span class="text-right">{{ latestChange }}</span>
            </div>
            <div class="flex items-center justify-between gap-3 py-2.5">
              <span class="text-muted-foreground">Latest from others</span>
              <span class="text-right truncate">{{ latestFromOthers }}</span>
            </div>
          </div>

          <div v-if="status.canEdit">
            <div class="text-[13px] font-semibold text-muted-foreground pb-1">Relays</div>
            <div v-for="r in relayRows" :key="r.url" class="flex h-[38px] items-center gap-2.5 text-sm">
              <Check v-if="r.state === 'latest'" class="size-4 shrink-0" :stroke-width="2.5" />
              <X v-else-if="r.state === 'failed'" class="size-4 shrink-0 text-red-600 dark:text-red-400" :stroke-width="2.5" />
              <Circle
                v-else
                class="size-4 shrink-0"
                :class="r.state === 'older' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'"
                :stroke-width="2.5"
              />
              <span class="flex-1 truncate">{{ r.host }}</span>
              <span class="text-[13px]" :class="r.textClass">{{ r.label }}</span>
            </div>
          </div>
        </div>

        <DrawerFooter class="shrink-0">
          <Button v-if="canSendAgain" :disabled="!sync.online" @click="sync.sendAgain(boardId)">Send again</Button>
          <DrawerClose as-child>
            <Button variant="outline">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Check, Circle, CloudAlert, CloudCheck, CloudDownload, CloudUpload, Smartphone, X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { RELAYS } from '@/nostr'
import { useSyncStore, type RelayStatus } from '@/stores/sync'
import { useProfilesStore } from '@/stores/profiles'

const props = defineProps<{ open: boolean; boardId: string }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const sync = useSyncStore()
const profiles = useProfilesStore()
const status = computed(() => (props.boardId ? sync.statusFor(props.boardId) : null))

function changesLabel(n: number | null) {
  if (!n) return 'Changes'
  return `${n} ${n === 1 ? 'change' : 'changes'}`
}

const title = computed(() => {
  const s = status.value
  if (!s) return ''
  switch (s.state) {
    case 'pending': return `${changesLabel(s.count)} ${s.count === 1 ? 'is' : 'are'} only on this phone`
    case 'offline': return `${changesLabel(s.count)} saved on this phone`
    case 'sending': return 'Sending changes…'
    case 'checking': return 'Checking for updates…'
    default: return s.canEdit ? 'All changes are on relays' : 'Up to date'
  }
})

const description = computed(() => {
  const s = status.value
  if (!s) return ''
  switch (s.state) {
    case 'pending': return "Other editors won't see them yet. Lik retries automatically every 15 seconds."
    case 'offline': return "You're offline. They will be sent when the connection is back."
    case 'sending': return 'Waiting for relays to confirm they have them.'
    case 'checking': return 'Loading the latest scores from relays.'
    default: return s.canEdit ? 'Other editors see your latest scores.' : 'You see the latest scores from relays.'
  }
})

const iconWrapClass = computed(() => {
  const st = status.value?.state
  if (st === 'pending' || st === 'offline') return 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
  return 'bg-muted text-muted-foreground'
})

const canSendAgain = computed(() => {
  const st = status.value?.state
  return !!status.value?.canEdit && (st === 'pending' || st === 'offline')
})

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === new Date().toDateString()) return time
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
}

const latestChange = computed(() => {
  const s = status.value
  if (!s || !s.lastLocalAt) return '—'
  const tracked = Object.values(s.relays)
  if (!tracked.length) return fmtTime(s.lastLocalAt)
  const latest = tracked.filter((r) => r.state === 'latest').length
  return `${fmtTime(s.lastLocalAt)} · on ${latest} of ${RELAYS.length} relays`
})

const latestFromOthers = computed(() => {
  const s = status.value
  if (!s || !s.lastReceivedAt) return 'Nothing yet'
  const who = profiles.get(s.lastReceivedFrom)?.name || s.lastReceivedFrom.slice(0, 8)
  return `${fmtTime(s.lastReceivedAt * 1000)} · ${who}`
})

function failedLabel(reason = ''): string {
  const r = reason.toLowerCase()
  if (r.includes('rate')) return 'Rejected: rate-limited'
  if (/timed out|timeout|websocket|connection|closed|no response/.test(r)) return 'No connection'
  return 'Rejected'
}

const relayRows = computed(() => {
  const relays = status.value?.relays || {}
  return RELAYS.map((url) => {
    const st: RelayStatus | undefined = relays[url]
    const host = url.replace(/^wss:\/\//, '')
    switch (st?.state) {
      case 'latest': return { url, host, state: st.state, label: 'Has latest', textClass: 'text-foreground' }
      case 'older': return { url, host, state: st.state, label: 'Older version', textClass: 'text-amber-700 dark:text-amber-400' }
      case 'failed': return { url, host, state: st.state, label: failedLabel(st.reason), textClass: 'text-red-600 dark:text-red-400' }
      case 'sending': return { url, host, state: st.state, label: 'Sending…', textClass: 'text-muted-foreground' }
      default: return { url, host, state: 'unknown', label: 'Not checked yet', textClass: 'text-muted-foreground' }
    }
  })
})
</script>
