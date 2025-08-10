<template>
  <div class="p-4 space-y-6">
    <h1 class="text-2xl font-semibold">{{ scoreboard?.name ?? 'Scoreboard' }}</h1>
    <div class="text-xs text-gray-500 mt-12">UUID: {{ id }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useScoreboardsStore } from '@/stores/scoreboards'

const route = useRoute()
const id = computed(() => String(route.params.id || ''))

const store = useScoreboardsStore()
const scoreboard = computed(() => store.items.find((s) => s.id === id.value))
</script>
