import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      controllers: fileURLToPath(new URL('./app/javascript/controllers', import.meta.url)),
      '@hotwired/turbo-rails': fileURLToPath(new URL('./test/javascript/stubs/turbo_rails.js', import.meta.url)),
      '@hotwired/stimulus-loading': fileURLToPath(new URL('./test/javascript/stubs/stimulus_loading.js', import.meta.url))
    }
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./test/javascript/setup.js'],
    include: ['test/javascript/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
    singleThread: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['app/javascript/controllers/**/*.{js,ts,jsx,tsx}']
    }
  }
})
