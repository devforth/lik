import { createRouter, createWebHistory } from 'vue-router'
import NewScoreboard from '@/views/NewScoreboard.vue'
import Scoreboard from '@/views/Scoreboard.vue'
import JoinBoard from '@/views/JoinBoard.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/new-scoreboard',
      name: 'new-scoreboard',
      component: NewScoreboard,
    },
    {
      path: '/scoreboard/:id/',
      name: 'scoreboard',
      component: Scoreboard,
    },
    {
      path: '/join-board',
      name: 'join-board',
      component: JoinBoard,
    },
  ],
})

export default router
