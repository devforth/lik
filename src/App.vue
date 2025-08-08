

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
                <SidebarMenuItem v-for="w in workspaces" :key="w.name">
                  <SidebarMenuButton asChild>
                    <a :href="w.url">
                      <span>{{w.name}}</span>
                    </a>
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
      <main>
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
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui';


const workspaces = [
  {name: "Workspace 1"},
  {name: "Workspace 2"},
  {name: "Workspace 3"}
]
</script>