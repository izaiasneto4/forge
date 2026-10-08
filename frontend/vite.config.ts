import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The Bun API (backend/) listens on :3000 by default; ORDEM_API_URL points elsewhere.
const apiTarget = process.env.ORDEM_API_URL ?? process.env.FORGE_API_URL ?? 'http://localhost:3000'

export default defineConfig({
  base: '/frontend/',
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
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
      // App icons and brand files live in the repository's public/, which the API serves.
      '^/(favicon\\.(svg|ico)|apple-touch-icon\\.png|icon\\.(png|svg)|brand/)': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
