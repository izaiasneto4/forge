import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import FlashController from '../../../app/javascript/controllers/flash_controller.js'

describe('FlashController', () => {
  let application
  let controller

  beforeEach(() => {
    vi.useFakeTimers()
    application = Application.start()
    application.register('flash', FlashController)
    document.body.innerHTML = `
      <div data-controller="flash" data-flash-auto-dismiss-value="true" data-flash-delay-value="2000">
        Flash message
      </div>
    `
    const element = document.querySelector('[data-controller="flash"]')
    controller = application.getControllerForElementAndIdentifier(element, 'flash')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects and sets up auto-dismiss', () => {
    expect(controller).toBeDefined()
    expect(controller.autoDismissValue).toBe(true)
    expect(controller.delayValue).toBe(2000)
  })

  it('auto-dismisses flash message', () => {
    vi.advanceTimersByTime(2000)

    expect(controller.element.classList.contains('opacity-0')).toBe(true)
  })

  it('dismisses flash message manually', () => {
    controller.dismiss()

    expect(controller.element.classList.contains('opacity-0')).toBe(true)
  })

  it('removes element after dismiss', () => {
    controller.dismiss()

    vi.advanceTimersByTime(300)

    expect(document.querySelector('[data-controller="flash"]')).toBe(null)
  })

  it('does not auto-dismiss when disabled', () => {
    document.body.innerHTML = `
      <div data-controller="flash" data-flash-auto-dismiss-value="false">
        Flash message
      </div>
    `
    const element = document.querySelector('[data-controller="flash"]')
    const customController = application.getControllerForElementAndIdentifier(element, 'flash')

    vi.advanceTimersByTime(2000)

    expect(element.classList.contains('opacity-0')).toBe(false)
  })

  it('uses custom delay value', () => {
    document.body.innerHTML = `
      <div data-controller="flash" data-flash-auto-dismiss-value="true" data-flash-delay-value="5000">
        Flash message
      </div>
    `
    const element = document.querySelector('[data-controller="flash"]')
    const customController = application.getControllerForElementAndIdentifier(element, 'flash')

    vi.advanceTimersByTime(3000)
    expect(element.classList.contains('opacity-0')).toBe(false)

    vi.advanceTimersByTime(2000)
    expect(element.classList.contains('opacity-0')).toBe(true)
  })

  it('clears timeout on disconnect', () => {
    controller.disconnect()

    vi.advanceTimersByTime(5000)

    expect(controller.element.classList.contains('opacity-0')).toBe(false)
  })
})
