<template>
  <Drawer :open="open" @update:open="(v) => emit('update:open', v)">
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
</template>

<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'

const props = defineProps<{
  open: boolean
  ownerProfile: { picture?: string; name?: string; pubkey: string } | null
  members: Array<{ pubkey: string; name?: string; picture?: string }>
  short: (pk: string) => string
}>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()
</script>
