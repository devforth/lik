import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'


import '@/styles.css'
import { initScale } from './ui-scale'
import { initTheme } from './theme'
import { useUserStore } from './stores/user'
import { useScoreboardsStore } from './stores/scoreboards'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Initialize UI scaling early
initScale()
// Initialize theme (respects OS and persisted user preference)
initTheme()

// Initialize user profile (the store will publish to Nostr on create/changes)
const userStore = useUserStore()
void userStore.ensureUser()

// Subscribe to scoreboard join requests on app start and on creation of new scoreboards
const sbStore = useScoreboardsStore()
// Ensure scoreboards are loaded, then let the store manage Nostr subscriptions
void (async () => {
	await sbStore.ensureLoaded()
})()

app.mount('#app')
