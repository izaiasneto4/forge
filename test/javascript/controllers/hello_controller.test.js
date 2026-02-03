import { describe, it, expect, beforeEach } from 'vitest'
import { Application } from '@hotwired/stimulus'
import HelloController from '../../../app/javascript/controllers/hello_controller.js'

describe('HelloController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('hello', HelloController)
    document.body.innerHTML = `
      <div data-controller="hello"></div>
    `
    const element = document.querySelector('[data-controller="hello"]')
    controller = application.getControllerForElementAndIdentifier(element, 'hello')
  })

  it('connects and displays Hello World', () => {
    expect(controller).toBeDefined()
    expect(controller.element.textContent).toBe('Hello World!')
  })
})
