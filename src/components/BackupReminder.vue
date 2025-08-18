<template>
  <Drawer v-model:open="open">
    <DrawerContent>
      <div class="mx-auto w-full max-w-lg p-4 space-y-4">
        <DrawerHeader class="p-0">
          <DrawerTitle>Back up your secret code</DrawerTitle>
          <DrawerDescription>
            This code unlocks your account and scoreboards. Write it down and keep it safe.
          </DrawerDescription>
        </DrawerHeader>

        <div class="space-y-3">
          <Button variant="outline" @click="onShow" :disabled="reveal" class="w-full justify-start">
            Show my secret code
          </Button>
          <div v-if="reveal" class="space-y-2">
            <label class="text-sm text-muted-foreground">Secret code (nsec1…)</label>
            <div class="flex gap-2 items-center">
              <input :value="nsec" readonly class="font-mono file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 flex-1 min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm" />
              <Button size="sm" @click="copyNsec">Copy</Button>
            </div>
          </div>
        </div>

        <DrawerFooter class="p-0 flex gap-2 flex-col sm:flex-row">
          <Button class="flex-1" :disabled="!reveal" @click="onWritten">I wrote down my code</Button>
          <Button variant="outline" class="flex-1" @click="onLater">Remind me later</Button>
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { useBackupReminderStore } from '@/stores/backupReminder'
import { useUserStore } from '@/stores/user'
import { nip19 } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import { toast } from 'vue-sonner'

const store = useBackupReminderStore()
const user = useUserStore()
const open = computed({ get: () => store.open, set: (v) => (store.open = v) })
const reveal = computed(() => store.reveal)
const nsec = computed(() => {
  const hex = user.getPrivKey()
  if (!hex) return ''
  try { return nip19.nsecEncode(hexToBytes(hex)) } catch { return '' }
})

function onShow() { store.showSecret() }
function onWritten() { store.markWritten(); toast.success('Thanks! Backup confirmed') }
function onLater() { store.remindLater() }
async function copyNsec() { try { await navigator.clipboard.writeText(nsec.value || '') ; toast.success('Code copied') } catch {} }
</script>
