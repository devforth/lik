<script setup lang="ts">
import { useSidebar } from '@/components/ui/sidebar'

// Wrap any clickable content and auto-close the mobile sidebar when clicked.
const { isMobile, openMobile, setOpenMobile } = useSidebar()

function maybeClose() {
  if (isMobile?.value && openMobile?.value) setOpenMobile(false)
}
</script>

<template>
  <span class="contents" @click="maybeClose">
    <slot />
  </span>
</template>
