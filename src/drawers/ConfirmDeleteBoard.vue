<template>
  <Drawer :open="open" @update:open="(v) => emit('update:open', v)">
    <DrawerContent>
      <div class="mx-auto w-full max-w-sm">
        <DrawerHeader>
          <DrawerTitle>Delete scoreboard?</DrawerTitle>
          <DrawerDescription>
            Are you sure you want to delete this scoreboard? If it exists for other editors, they have to delete it by themselves.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button variant="destructive" @click="emit('confirm')">Yes, delete</Button>
          <DrawerClose as-child>
            <Button variant="outline">No, keep</Button>
          </DrawerClose>
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>
</template>

<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'confirm'): void }>()
</script>
