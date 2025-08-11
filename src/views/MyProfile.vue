<template>
  <div class="p-4 space-y-4">
    <h1 class="text-xl font-semibold">My Profile</h1>
    <div class="space-y-2 max-w-md">
      <label class="text-sm text-muted-foreground">Username</label>
      <div class="flex items-center gap-2">
        <Input v-model="draftName" @keyup.enter="onSave" @blur="onSave" />
        <Button size="sm" v-if="showSave" @click="onSave">Save</Button>
      </div>
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
import { onMounted, ref, computed, watch } from 'vue'

const userStore = useUserStore()

onMounted(() => {
  userStore.ensureUser()
})
const { nickname, avatarDataUri, avatarSeed } = storeToRefs(userStore)
const draftName = ref('')
// keep local draft in sync with store nickname (initially and on external updates)
watch(nickname, (n) => { draftName.value = n || '' }, { immediate: true })
const showSave = computed(() => {
  const n = (draftName.value || '').trim()
  return !!n && n !== (nickname.value || '')
})
async function onSave() {
  if (!showSave.value) return
  await userStore.updateNickname((draftName.value || '').trim())
}
const avatar = avatarDataUri
const seed = avatarSeed
const regen = () => userStore.regenerateAvatarSeed()
</script>
