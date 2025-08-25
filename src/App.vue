

<template>
  <div class="safe-top">
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>
              Scoreboards
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <template v-if="scoreboards.length">
                <SidebarMenu>
                  <SidebarMenuItem v-for="sb in scoreboards" :key="sb.id">
                    <SidebarMenuButton asChild @click="goToScoreboard(sb.id)">
                      <CloseMobileSidebar>
                        <span>{{ sb.name }}</span>
                      </CloseMobileSidebar>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </template>
              <template v-else>
                <p class="px-2 py-1 text-xs text-muted-foreground">No scoreboards yet</p>
              </template>
            </SidebarGroupContent>

            <CloseMobileSidebar>
              <Button class="mt-4" @click="createNewScoreboard">New scoreboard</Button>
              <Button class="mt-2" variant="outline" @click="joinBoard">Join the board</Button>
            </CloseMobileSidebar>


          </SidebarGroup>
          <SidebarGroup />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton class="text-xs px-0 justify-between">
                <span>Dark mode</span>

                 <SidebarMenuAction as-child>
                  <Switch :model-value="isDark" @update:model-value="toggleTheme">
                    <template #thumb>
                      <Moon v-if="isDark" class="size-3" />
                      <Sun v-else class="size-3" />
                    </template>
                  </Switch>
                </SidebarMenuAction>
              </SidebarMenuButton>
             
            </SidebarMenuItem>

            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger class="pl-0 pr-0" asChild>
                  <SidebarMenuButton>
                    <img :src="avatar" alt="avatar" class="size-8 rounded" /> {{ displayName }}
                    <ChevronUp class="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  class="w-[--reka-popper-anchor-width]"
                >
                  <CloseMobileSidebar>
                    <DropdownMenuItem @click="goProfile">
                      <span>My Profile</span>
                    </DropdownMenuItem>
                  </CloseMobileSidebar>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>

          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <main class="w-full">
        <div class="flex items-center gap-2 p-2">
          <SidebarTrigger />
          <div v-if="!isOnline" class="flex items-center gap-1 text-red-500 select-none">
            <WifiOff class="h-5 w-5" />
            <span class="text-sm font-medium">Offline</span>
          </div>
        </div>
  <RouterView />
  <TopLogNotify />
        <BackupReminder />
        <Toaster class="pointer-events-auto" />
      </main>
    </SidebarProvider>
  </div>
</template>

<style scoped></style>

<script setup lang="ts">
import { Button } from '@/components/ui/button'
import Sidebar from '@/components/ui/sidebar/Sidebar.vue'
import { SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import CloseMobileSidebar from '@/components/CloseMobileSidebar.vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useScoreboardsStore } from '@/stores/scoreboards'
import { useUserStore } from '@/stores/user'
import { Toaster } from '@/components/ui/sonner'
import 'vue-sonner/style.css'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronUp, WifiOff, Moon, Sun } from 'lucide-vue-next'
import { Switch } from '@/components/ui/switch'
import { useTheme } from './theme'
import BackupReminder from '@/components/BackupReminder.vue'
import TopLogNotify from '@/components/TopLogNotify.vue'


const scoreboardsStore = useScoreboardsStore()
const { items: scoreboards } = storeToRefs(scoreboardsStore)

// user store
const userStore = useUserStore()
const { nickname, avatarDataUri } = storeToRefs(userStore)
const displayName = computed(() => nickname.value || 'Anonymous')
const avatar = avatarDataUri

const router = useRouter()
function createNewScoreboard() {
  router.push({ name: 'new-scoreboard' })
}

function goToScoreboard(id: string) {
  router.push({ name: 'scoreboard', params: { id } })
}

function joinBoard() {
  router.push({ name: 'join-board' })
}

function goProfile() {
  router.push({ name: 'my-profile' })
}

// Network status indicator
const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
const handleOnline = () => { isOnline.value = true }
const handleOffline = () => { isOnline.value = false }

onMounted(() => {
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
})

onBeforeUnmount(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
})

// Theme
const { isDark, toggleTheme } = useTheme()
</script>