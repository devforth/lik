

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

            <Button class="mt-4" @click="createNewScoreboard">New scoreboard</Button>


          </SidebarGroup>
          <SidebarGroup />
        </SidebarContent>
        <SidebarFooter />
      </Sidebar>
      <main class="w-full">
        <SidebarTrigger />
        <RouterView />
      </main>
    </SidebarProvider>
  </div>
</template>

<style scoped></style>

<script setup lang="ts">
import { Button } from '@/components/ui/button'
import Sidebar from '@/components/ui/sidebar/Sidebar.vue'
import { SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useScoreboardsStore } from '@/stores/scoreboards'


const scoreboardsStore = useScoreboardsStore()
const { items: scoreboards } = storeToRefs(scoreboardsStore)

const router = useRouter()
function createNewScoreboard() {
  router.push({ name: 'new-scoreboard' })
}

function goToScoreboard(id: string) {
  router.push({ name: 'scoreboard', params: { id } })
}
</script>