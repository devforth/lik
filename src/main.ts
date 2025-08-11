import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'


import '@/styles.css'
import { initScale } from './ui-scale'
import { useUserStore } from './stores/user'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Initialize UI scaling early
initScale()

// Initialize user profile (load from IndexedDB or create new)
// Note: fire-and-forget; downstream modules can await useUserStore().ensureUser() if needed
useUserStore().ensureUser()

app.mount('#app')
