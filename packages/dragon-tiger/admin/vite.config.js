import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5275,
    proxy: {
      '/admin': 'http://localhost:4101',
    },
  },
})
