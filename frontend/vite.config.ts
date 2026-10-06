import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Set FORGE_API_URL=http://localhost:3100 to send /api through the Bun backend,
// which serves ported routes and forwards the rest to Rails.
const apiTarget = process.env.FORGE_API_URL ?? 'http://localhost:3000'

export default defineConfig({
  base: '/frontend/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../public/frontend',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/cable': {
        target: 'ws://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
