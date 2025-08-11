import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'


import '@/styles.css'
import { initScale } from './ui-scale'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Initialize UI scaling early
initScale()

app.mount('#app')
