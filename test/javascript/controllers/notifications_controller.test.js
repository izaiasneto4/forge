import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import { createConsumer } from '@rails/actioncable'
import NotificationsController from '../../../app/javascript/controllers/notifications_controller.js'

describe('NotificationsController', () => {
  let application
  let controller

  beforeEach(() => {
    vi.useFakeTimers()
    application = Application.start()
    application.register('notifications', NotificationsController)
    document.body.innerHTML = '<div data-controller="notifications"></div>'
    const element = document.querySelector('[data-controller="notifications"]')
    controller = application.getControllerForElementAndIdentifier(element, 'notifications')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates action cable subscription on connect', () => {
    expect(controller).toBeDefined()
    expect(createConsumer).toHaveBeenCalled()
  })

  it('shows success toast for completed review', () => {
    controller.handleNotification({ type: 'review_completed', pr_number: 42 })

    const toast = document.querySelector('.global-toast')
    expect(toast.textContent).toContain('Review completed for PR #42')
    expect(toast.className).toContain('global-toast--success')
  })

  it('shows error toast for failed review', () => {
    controller.handleNotification({ type: 'review_failed', pr_number: 42, reason: 'lint failed' })

    const toast = document.querySelector('.global-toast')
    expect(toast.textContent).toContain('Review failed for PR #42: lint failed')
    expect(toast.className).toContain('global-toast--error')
  })

  it('replaces existing toast', () => {
    controller.showToast('first')
    controller.showToast('second')

    const toasts = document.querySelectorAll('.global-toast')
    expect(toasts.length).toBe(1)
    expect(toasts[0].textContent).toContain('second')
  })

  it('auto removes toast after timeout', () => {
    controller.showToast('first')

    vi.runAllTimers()

    expect(document.querySelector('.global-toast')).toBeNull()
  })

  it('disconnect unsubscribes existing subscription', () => {
    const unsubscribe = vi.fn()
    controller.subscription = { unsubscribe }

    controller.disconnect()

    expect(unsubscribe).toHaveBeenCalled()
  })
})
