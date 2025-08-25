<template>
  <Drawer :open="open" @update:open="(v) => emit('update:open', v)">
    <DrawerContent>
      <div class="mx-auto w-full max-w-md max-h-[66vh] flex flex-col">
        <DrawerHeader class="shrink-0">
          <DrawerTitle>Activity log</DrawerTitle>
          <DrawerDescription>Last edits</DrawerDescription>
        </DrawerHeader>

        <div class="px-4 pb-4 space-y-3 flex-1 overflow-y-auto min-h-0" v-if="open">
          <div v-if="!logList.length" class="text-sm text-muted-foreground">No activity yet.</div>
          <div v-for="e in logList" :key="e[0]" class="flex items-start gap-3">
            <img :src="eAvatar(e[1])" class="h-8 w-8 rounded-md bg-muted object-cover" alt="avatar" />
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">{{ eName(e[1]) }}</div>
              <div class="text-xs text-muted-foreground">{{ relTime(e[2]) }}</div>
              <div class="text-sm mt-1">
                <span v-if="/^\+[0-9]+$/.test(e[4])">{{ e[4] }}</span>
                <span v-else-if="/^-[0-9]+$/.test(e[4])">{{ e[4] }}</span>
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
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'

const props = defineProps<{
  open: boolean
  logList: [string, string, number, string, string, string | null][]
  eName: (pubkey: string) => string
  eAvatar: (pubkey: string) => string
  relTime: (tsSec: number) => string
  participantName: (pid: string) => string
  categoryName: (cid: string) => string
}>()

const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const logList = computed(() => props.logList)
</script>
