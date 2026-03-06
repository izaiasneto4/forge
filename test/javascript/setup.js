import { beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { Window } from 'happy-dom'
import { Application } from '@hotwired/stimulus'
import * as Turbo from '@hotwired/turbo'

vi.mock('@hotwired/turbo', () => ({
  renderStreamMessage: vi.fn()
}))

vi.mock('@rails/actioncable', () => ({
  createConsumer: vi.fn(() => ({
    subscriptions: {
      create: vi.fn(() => ({
        unsubscribe: vi.fn()
      }))
    },
    disconnect: vi.fn()
  }))
}))

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const htmlPath = resolve(__dirname, '../fixtures/index.html')
const html = readFileSync(htmlPath, 'utf8')

if (!Application.__testPatchedStart) {
  const originalStart = Application.start
  Application.start = function(element, schema) {
    const application = new this(element, schema)
    application.dispatcher.start()
    application.router.start()
    return application
  }
  Application.__testPatchedStart = originalStart
}

if (!Application.__testPatchedGetController) {
  const originalGetController = Application.prototype.getControllerForElementAndIdentifier
  Application.prototype.getControllerForElementAndIdentifier = function(element, identifier) {
    let controller = originalGetController.call(this, element, identifier)
    if (!controller && element) {
      this.router.proposeToConnectScopeForElementAndIdentifier(element, identifier)
      controller = originalGetController.call(this, element, identifier)
    }
    return controller
  }
  Application.__testPatchedGetController = originalGetController
}

beforeEach(() => {
  const window = new Window({ url: 'http://localhost:3000' })
  window.document.write(html)

  global.window = window
  global.document = window.document
  global.navigator = window.navigator
  global.Node = window.Node
  global.Element = window.Element
  global.HTMLElement = window.HTMLElement
  global.CustomEvent = window.CustomEvent
  global.KeyboardEvent = window.KeyboardEvent
  global.Event = window.Event
  global.fetch = vi.fn()
  global.Turbo = Turbo
  window.Turbo = Turbo
  window.alert = vi.fn()
  global.alert = window.alert

  Object.defineProperty(window.navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined)
    },
    configurable: true
  })

  global.csrfToken = 'test-csrf-token'
  document.head.innerHTML = `<meta name="csrf-token" content="${global.csrfToken}">`
})

afterEach(() => {
  vi.clearAllMocks()
})
