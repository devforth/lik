<template>
  <div class="p-4 space-y-4">
    <h1 class="text-xl font-semibold">My Profile</h1>
    <div class="space-y-2 max-w-md">
      <label class="text-sm text-muted-foreground">Username</label>
      <Input v-model="name" readonly />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Input } from '@/components/ui/input'
import { useUserStore } from '@/stores/user'
import { storeToRefs } from 'pinia'
import { onMounted } from 'vue'

const userStore = useUserStore()

onMounted(() => {
  userStore.ensureUser()
})
const { nickname } = storeToRefs(userStore)
const name = nickname
</script>
