<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useScoreboardsStore } from '@/stores/scoreboards'

const router = useRouter()
const store = useScoreboardsStore()

onMounted(async () => {
  // wait store hydration
  await store.ensureLoaded?.()

  // Prefer last open from localStorage
  const LAST_KEY = 'lik:lastScoreboardId'
  const last = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_KEY) : null
  if (last && store.items.find((s) => s.id === last)) {
    router.replace({ name: 'scoreboard', params: { id: last } })
    return
  }

  // Otherwise open any available (use first)
  if (store.items.length) {
    router.replace({ name: 'scoreboard', params: { id: store.items[0].id } })
    return
  }

  // If no boards, go to new scoreboard or join page. Choose new by default
  router.replace({ name: 'new-scoreboard' })
})
</script>

<template>
  <div class="p-4 text-sm text-muted-foreground">Loading…</div>
  <!-- Redirecting -->
</template>
