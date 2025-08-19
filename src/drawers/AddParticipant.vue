<template>
  <Drawer :open="open" @update:open="(v) => emit('update:open', v)">
    <DrawerContent>
      <div class="mx-auto w-full max-w-sm">
        <DrawerHeader>
          <DrawerTitle>Add participant</DrawerTitle>
          <DrawerDescription>Create a participant name.</DrawerDescription>
        </DrawerHeader>
        <form class="px-4 pb-2 space-y-4" @submit.prevent="emitAdd">
          <div class="space-y-2">
            <label class="text-sm" for="participant-name">Name</label>
            <Input id="participant-name" v-model="name" placeholder="e.g., Carol" ref="inputRef" />
          </div>
        </form>
        <DrawerFooter>
          <Button :disabled="!name.trim()" @click="emitAdd">Add</Button>
          <DrawerClose as-child>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'add', name: string): void }>()

const name = ref('')
const inputRef = ref<any>(null)

watch(() => props.open, (open) => {
  if (open) {
    name.value = ''
    nextTick(() => {
      if (inputRef.value?.focus) inputRef.value.focus()
      else if (inputRef.value?.el?.focus) inputRef.value.el.focus()
    })
  }
})

function emitAdd() {
  const val = name.value.trim()
  if (!val) return
  emit('add', val)
}
</script>
