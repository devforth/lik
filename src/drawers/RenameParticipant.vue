<template>
  <Drawer :open="open" @update:open="(v) => emit('update:open', v)">
    <DrawerContent>
      <div class="mx-auto w-full max-w-sm">
        <DrawerHeader>
          <DrawerTitle>Rename participant</DrawerTitle>
          <DrawerDescription>Update the participant name.</DrawerDescription>
        </DrawerHeader>
        <form class="px-4 pb-2 space-y-4" @submit.prevent="emitRename">
          <div class="space-y-2">
            <label class="text-sm" for="rename-participant-name">Name</label>
            <Input id="rename-participant-name" v-model="name" placeholder="Name" ref="inputRef" />
          </div>
        </form>
        <DrawerFooter>
          <Button :disabled="!name.trim()" @click="emitRename">Save</Button>
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

const props = defineProps<{ open: boolean; modelValue: string }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'update:modelValue', v: string): void; (e: 'rename'): void }>()

const name = ref('')
const inputRef = ref<any>(null)

watch(() => props.open, (open) => {
  if (open) {
    name.value = props.modelValue || ''
    nextTick(() => {
      if (inputRef.value?.focus) inputRef.value.focus()
      else if (inputRef.value?.el?.focus) inputRef.value.el.focus()
    })
  }
})

watch(() => props.modelValue, (v) => { if (!props.open) name.value = v })

function emitRename() {
  const val = name.value.trim()
  if (!val) return
  emit('update:modelValue', val)
  emit('rename')
}
</script>
