<template>
  <div class="p-4 space-y-4 w-full max-w-full">
    <div class="space-y-2 w-full">
      <label for="scoreboard-name" class="mt-10 block text-sm text-center font-medium text-foreground">Scoreboard name</label>
      <Input
        id="scoreboard-name"
        v-model="name"
        autofocus
        placeholder="Enter name"
        class="w-full"
        @keyup.enter="onCreate"
      />
    </div>

    <Button class="w-full" @click="onCreate">Create</Button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useScoreboardsStore } from '@/stores/scoreboards'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useRouter } from 'vue-router'

const name = ref('')
const scoreboards = useScoreboardsStore()
const router = useRouter()

function onCreate() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  const created = scoreboards.createScoreboard(trimmed)
  console.log('Create Scoreboard:', created)
  name.value = ''
  // Navigate to the newly created scoreboard
  router.push({ name: 'scoreboard', params: { id: created.id } })
}
</script>

<style scoped></style>
