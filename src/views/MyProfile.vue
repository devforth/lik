<template>
  <div class="p-4 space-y-4">
    <h1 class="text-xl font-semibold">My Profile</h1>
    <div class="space-y-2 max-w-md">
      <label class="text-sm text-muted-foreground">Username</label>
      <Input v-model="name" readonly />
    </div>
    <div class="flex items-center gap-4">
      <img :src="avatar" alt="avatar" class="w-20 h-20 rounded-xl border" />
      <div class="space-y-1">
        <div class="text-sm text-muted-foreground">Avatar seed</div>
        <div class="font-mono text-sm">{{ seed }}</div>
        <Button size="sm" @click="regen">Regenerate</Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useUserStore } from '@/stores/user'
import { storeToRefs } from 'pinia'
import { onMounted } from 'vue'

const userStore = useUserStore()

onMounted(() => {
  userStore.ensureUser()
})
const { nickname, avatarDataUri, avatarSeed } = storeToRefs(userStore)
const name = nickname
const avatar = avatarDataUri
const seed = avatarSeed
const regen = () => userStore.regenerateAvatarSeed()
</script>
