

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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton>
                    <User2 /> {{ displayName }}
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
        <SidebarTrigger />
        <RouterView />
  <!-- Sonner toaster -->
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
import { computed } from 'vue'
import { User2, ChevronUp } from 'lucide-vue-next'


const scoreboardsStore = useScoreboardsStore()
const { items: scoreboards } = storeToRefs(scoreboardsStore)

// user store
const userStore = useUserStore()
const { nickname } = storeToRefs(userStore)
const displayName = computed(() => nickname.value || 'Anonymous')

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
</script>