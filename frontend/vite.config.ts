import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Bun API (backend/) listens on :3000 by default; FORGE_API_URL points elsewhere.
const apiTarget = process.env.FORGE_API_URL ?? 'http://localhost:3000'

export default defineConfig({
  base: '/frontend/',
  plugins: [react()],
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
      '/ws': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
