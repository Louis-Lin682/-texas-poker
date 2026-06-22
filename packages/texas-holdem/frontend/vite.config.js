import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5275,
    proxy: {
      '/auth': 'http://localhost:4300',
      '/ws':   { target: 'ws://localhost:4300', ws: true },
    },
  },
})
