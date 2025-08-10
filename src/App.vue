

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
              <SidebarMenu>
                <SidebarMenuItem v-for="sb in scoreboards" :key="sb.id">
                  <SidebarMenuButton asChild @click="goToScoreboard(sb.id)">
                    <span>{{ sb.name }}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>

            <CloseMobileSidebar>
              <Button class="mt-4" @click="createNewScoreboard">New scoreboard</Button>
              <Button class="mt-2" variant="outline" @click="joinBoard">Join the board</Button>
            </CloseMobileSidebar>


          </SidebarGroup>
          <SidebarGroup />
        </SidebarContent>
        <SidebarFooter />
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
import CloseMobileSidebar from '@/components/CloseMobileSidebar.vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useScoreboardsStore } from '@/stores/scoreboards'
import { Toaster } from '@/components/ui/sonner'
import 'vue-sonner/style.css'


const scoreboardsStore = useScoreboardsStore()
const { items: scoreboards } = storeToRefs(scoreboardsStore)

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
</script>