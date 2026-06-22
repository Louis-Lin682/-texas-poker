import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5274,
    proxy: {
      '/admin': { target: 'http://localhost:4201', changeOrigin: true },
    },
  },
})
