<template></template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useLogNotifyStore } from '@/stores/logNotify'
import { computed, watch, ref, onBeforeUnmount } from 'vue'
import { toast } from 'vue-sonner'

const store = useLogNotifyStore()
const { current, progress } = storeToRefs(store)
const cur = computed(() => current.value)
const toastId = ref<string | number | null>(null)

watch(cur, (val) => {
  if (val && !toastId.value) {
    // Show a single toast in top-center using Sonner. We control lifecycle via the store timer.
    toastId.value = toast(val.message, {
      duration: 1000000, // keep open; store will dismiss at 5s and queue next
      action: {
        label: 'Close',
        onClick: () => store.dismiss(),
      },
      // onDismiss (if supported) advances queue; ignore if not
      onDismiss: () => { try { store.dismiss() } catch {} },
    }) as any
  }
  if (!val && toastId.value != null) {
    try { toast.dismiss(toastId.value as any) } catch {}
    toastId.value = null
  }
})

function dismiss() {
  store.dismiss()
}

onBeforeUnmount(() => {
  if (toastId.value != null) {
    try { toast.dismiss(toastId.value as any) } catch {}
    toastId.value = null
  }
})
</script>

<style scoped>
</style>
