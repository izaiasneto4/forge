import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import ReviewModalController from '../../../app/javascript/controllers/review_modal_controller.js'

describe('ReviewModalController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('review-modal', ReviewModalController)
    document.body.innerHTML = `
      <div id="modal" class="hidden" data-controller="review-modal" data-review-modal-target="modal">
        <div data-review-modal-target="modalContent">
          <form data-review-modal-target="form">
            <input type="hidden" data-review-modal-target="prId" value="">
            <span data-review-modal-target="prTitle"></span>
            <select data-review-modal-target="cliClient">
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
              <option value="opencode">OpenCode</option>
            </select>
            <select data-review-modal-target="reviewType">
              <option value="full">Full</option>
              <option value="quick">Quick</option>
            </select>
            <div data-review-modal-target="cliClientIcon"></div>
          </form>
        </div>
      </div>
      <button id="open-btn" data-pr-id="123" data-pr-title="Test PR" data-pr-number="456" data-action="click->review-modal#open">Open</button>
    `
    const element = document.querySelector('[data-controller="review-modal"]')
    controller = application.getControllerForElementAndIdentifier(element, 'review-modal')

    document.addEventListener('keydown', controller.closeOnEscape.bind(controller))
  })

  afterEach(() => {
    document.removeEventListener('keydown', controller.closeOnEscape.bind(controller))
  })

  it('connects and sets up escape key listener', () => {
    expect(controller).toBeDefined()
  })

  it('opens modal with PR data', () => {
    const button = document.getElementById('open-btn')
    controller.open({ preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: button })

    expect(controller.prIdTarget.value).toBe('123')
    expect(controller.prTitleTarget.textContent).toBe('#456: Test PR')
    expect(controller.modalTarget.classList.contains('hidden')).toBe(false)
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('closes modal', () => {
    controller.modalTarget.classList.remove('hidden')

    controller.close()

    expect(controller.modalTarget.classList.contains('hidden')).toBe(true)
    expect(document.body.style.overflow).toBe('')
  })

  it('closes modal on backdrop click', () => {
    controller.modalTarget.classList.remove('hidden')

    const event = { target: controller.modalTarget }
    controller.closeOnBackdrop(event)

    expect(controller.modalTarget.classList.contains('hidden')).toBe(true)
  })

  it('does not close on content click', () => {
    controller.modalTarget.classList.remove('hidden')

    const event = { target: controller.modalContentTarget }
    controller.closeOnBackdrop(event)

    expect(controller.modalTarget.classList.contains('hidden')).toBe(false)
  })

  it('closes modal on escape key', () => {
    controller.modalTarget.classList.remove('hidden')

    const event = new KeyboardEvent('keydown', { key: 'Escape' })
    document.dispatchEvent(event)

    expect(controller.modalTarget.classList.contains('hidden')).toBe(true)
  })

  it('updates icon on client change', () => {
    controller.cliClientIconTarget.innerHTML = ''

    const event = { target: { value: 'claude' } }
    controller.updateIcon(event)

    expect(controller.cliClientIconTarget.innerHTML).toContain('<svg')
  })

  it('submits review task', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<turbo-stream>test</turbo-stream>')
    })

    controller.prIdTarget.value = '123'
    controller.cliClientTarget.value = 'claude'
    controller.reviewTypeTarget.value = 'full'

    await controller.submit({ preventDefault: vi.fn() })

    expect(global.fetch).toHaveBeenCalledWith(
      '/review_tasks',
      expect.objectContaining({
        method: 'POST'
      })
    )
  })

  it('handles submit errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('Error: test error')
    })

    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    await controller.submit({ preventDefault: vi.fn() })

    expect(alertSpy).toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  it('cleans up on disconnect', () => {
    controller.disconnect()

    expect(document.body.style.overflow).toBe('')
  })
})
