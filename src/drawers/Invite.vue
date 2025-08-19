<template>
  <Drawer :open="open" @update:open="(v) => emit('update:open', v)">
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
            <Button variant="outline" size="icon" @click="emit('copy')" :aria-label="copied ? 'Copied' : 'Copy'">
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
</template>

<script setup lang="ts">
import QrcodeVue from 'qrcode.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Copy, Check } from 'lucide-vue-next'

const props = defineProps<{ open: boolean; boardId: string; copied: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'copy'): void }>()
</script>
