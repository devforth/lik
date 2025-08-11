import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'


import '@/styles.css'
import { initScale } from './ui-scale'
import { useUserStore } from './stores/user'
import { useScoreboardsStore } from './stores/scoreboards'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Initialize UI scaling early
initScale()

// Initialize user profile (the store will publish to Nostr on create/changes)
const userStore = useUserStore()
void userStore.ensureUser()

// Subscribe to scoreboard join requests on app start and on creation of new scoreboards
const sStore = useScoreboardsStore()
// Ensure scoreboards are loaded, then let the store manage Nostr subscriptions
void (async () => {
	await sStore.ensureLoaded()
	sStore.startJoinSubscriptions()
})()

app.mount('#app')
