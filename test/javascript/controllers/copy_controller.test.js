import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import CopyController from '../../../app/javascript/controllers/copy_controller.js'

describe('CopyController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('copy', CopyController)
    document.body.innerHTML = `
      <div data-controller="copy" data-copy-content-value="test content">
        <button type="button" data-action="click->copy#copy">Copy</button>
      </div>
    `
    const element = document.querySelector('[data-controller="copy"]')
    controller = application.getControllerForElementAndIdentifier(element, 'copy')
  })

  it('connects with content value', () => {
    expect(controller.contentValue).toBe('test content')
  })

  it('copies content to clipboard', async () => {
    const button = document.querySelector('button')
    const originalHTML = button.innerHTML

    await controller.copy({ preventDefault: vi.fn(), currentTarget: button })

    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('test content')
    expect(button.innerHTML).toContain('Copied!')
  })

  it('handles clipboard errors', async () => {
    const button = document.querySelector('button')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    window.navigator.clipboard.writeText.mockRejectedValue(new Error('Failed'))

    await controller.copy({ preventDefault: vi.fn(), currentTarget: button })

    expect(consoleSpy).toHaveBeenCalledWith('Failed to copy:', expect.any(Error))
    consoleSpy.mockRestore()
  })

  it('restores button text after 2 seconds', async () => {
    vi.useFakeTimers()

    const button = document.querySelector('button')
    const originalHTML = button.innerHTML

    await controller.copy({ preventDefault: vi.fn(), currentTarget: button })

    vi.advanceTimersByTime(2000)

    expect(button.innerHTML).toBe(originalHTML)

    vi.useRealTimers()
  })
})
