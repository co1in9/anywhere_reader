import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { registerServiceWorker } from './reader/pwa.js'

createApp(App).mount('#app')
registerServiceWorker()
