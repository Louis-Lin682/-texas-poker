import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      '/api': { target: 'http://localhost:4100', rewrite: p => p.replace(/^\/api/, '') },
      '/ws':  { target: 'ws://localhost:4100',  ws: true },
    },
  },
})
