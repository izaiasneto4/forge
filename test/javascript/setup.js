import { beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { Window } from 'happy-dom'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const htmlPath = resolve(__dirname, '../fixtures/index.html')
const html = readFileSync(htmlPath, 'utf8')

beforeEach(() => {
  const window = new Window({ url: 'http://localhost:3000' })
  window.document.write(html)

  global.window = window
  global.document = window.document
  global.navigator = window.navigator
  global.fetch = vi.fn()
  global.Turbo = {
    renderStreamMessage: vi.fn()
  }
  global.ActionCable = {
    createConsumer: vi.fn(() => ({
      subscriptions: {
        create: vi.fn(() => ({
          unsubscribe: vi.fn()
        }))
      },
      disconnect: vi.fn()
    }))
  }

  window.navigator.clipboard = {
    writeText: vi.fn().mockResolvedValue(undefined)
  }

  global.csrfToken = 'test-csrf-token'
  document.head.innerHTML = `<meta name="csrf-token" content="${global.csrfToken}">`
})

afterEach(() => {
  vi.clearAllMocks()
})
