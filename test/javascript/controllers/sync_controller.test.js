import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import SyncController from '../../../app/javascript/controllers/sync_controller.js'

describe('SyncController', () => {
  let application
  let controller

  beforeEach(() => {
    vi.useFakeTimers()
    application = Application.start()
    application.register('sync', SyncController)
    document.body.innerHTML = `
      <div data-controller="sync">
        <button data-sync-target="button" data-action="click->sync#sync">
          <span data-sync-target="buttonText">Sync</span>
          <svg data-sync-target="spinner"></svg>
        </button>
        <button data-sync-target="forceButton" data-action="click->sync#forceSync">Force Sync</button>
        <div data-sync-target="modal" class="hidden">Syncing...</div>
      </div>
    `
    const element = document.querySelector('[data-controller="sync"]')
    controller = application.getControllerForElementAndIdentifier(element, 'sync')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects and auto-syncs', () => {
    expect(controller).toBeDefined()
    expect(controller.syncingValue).toBe(false)
  })

  it('shows modal on sync', () => {
    controller.syncingValue = true

    controller.showModal()

    expect(controller.modalTarget.classList.contains('hidden')).toBe(false)
  })

  it('hides modal', () => {
    controller.modalTarget.classList.remove('hidden')

    controller.hideModal()

    expect(controller.modalTarget.classList.contains('hidden')).toBe(true)
  })

  it('disables button during sync', () => {
    controller.disableButton()

    expect(controller.buttonTarget.classList.contains('opacity-50')).toBe(true)
    expect(controller.buttonTarget.classList.contains('cursor-not-allowed')).toBe(true)
    expect(controller.buttonTarget.classList.contains('pointer-events-none')).toBe(true)
  })

  it('enables button after sync', () => {
    controller.buttonTarget.classList.add('opacity-50', 'cursor-not-allowed', 'pointer-events-none')

    controller.enableButton()

    expect(controller.buttonTarget.classList.contains('opacity-50')).toBe(false)
    expect(controller.buttonTarget.classList.contains('cursor-not-allowed')).toBe(false)
    expect(controller.buttonTarget.classList.contains('pointer-events-none')).toBe(false)
  })

  it('updates button text during sync', () => {
    controller.disableButton()

    expect(controller.buttonTextTarget.textContent).toBe('Syncing...')
  })

  it('restores button text after sync', () => {
    controller.buttonTextTarget.textContent = 'Syncing...'

    controller.enableButton()

    expect(controller.buttonTextTarget.textContent).toBe('Sync')
  })

  it('spins spinner during sync', () => {
    controller.disableButton()

    expect(controller.spinnerTarget.classList.contains('animate-spin')).toBe(true)
  })

  it('stops spinner after sync', () => {
    controller.spinnerTarget.classList.add('animate-spin')

    controller.enableButton()

    expect(controller.spinnerTarget.classList.contains('animate-spin')).toBe(false)
  })

  it('disables force button during sync', () => {
    controller.disableButton()

    expect(controller.forceButtonTarget.classList.contains('opacity-50')).toBe(true)
  })

  it('syncs when not already syncing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<turbo-stream>test</turbo-stream>')
    })

    const event = { preventDefault: vi.fn() }

    controller.sync(event)

    expect(controller.syncingValue).toBe(true)
    expect(controller.modalTarget.classList.contains('hidden')).toBe(false)
  })

  it('does not sync when already syncing', () => {
    controller.syncingValue = true

    const event = { preventDefault: vi.fn() }

    controller.sync(event)

    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('force syncs', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('')
    })

    const event = { preventDefault: vi.fn() }

    await controller.forceSync(event)

    expect(global.fetch).toHaveBeenCalledWith(
      '/pull_requests/sync?force=true',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('resets after sync', () => {
    controller.syncingValue = true
    controller.modalTarget.classList.remove('hidden')
    controller.buttonTarget.classList.add('opacity-50')

    controller.reset()

    expect(controller.syncingValue).toBe(false)
    expect(controller.modalTarget.classList.contains('hidden')).toBe(true)
    expect(controller.buttonTarget.classList.contains('opacity-50')).toBe(false)
  })

  it('handles sync errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await controller.autoSync()

    expect(consoleSpy).toHaveBeenCalledWith('Auto-sync failed:', expect.any(Error))

    consoleSpy.mockRestore()
  })

  it('disconnects and cleans up', () => {
    controller.disconnect()

    expect(controller.syncingValue).toBe(false)
  })
})
