import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import FolderPickerController from '../../../app/javascript/controllers/folder_picker_controller.js'

describe('FolderPickerController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('folder-picker', FolderPickerController)
    document.body.innerHTML = `
      <div data-controller="folder-picker">
        <input type="text" data-folder-picker-target="input">
        <button data-action="click->folder-picker#pick">Pick Folder</button>
      </div>
    `
    document.head.innerHTML = `<meta name="csrf-token" content="test-csrf-token">`

    const element = document.querySelector('[data-controller="folder-picker"]')
    controller = application.getControllerForElementAndIdentifier(element, 'folder-picker')
  })

  it('connects', () => {
    expect(controller).toBeDefined()
    expect(controller.urlValue).toBe('/settings/pick_folder')
  })

  it('picks folder and updates input', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ path: '/selected/path' })
    })

    const button = document.querySelector('button')
    const event = { preventDefault: vi.fn(), currentTarget: button }

    await controller.pick(event)

    expect(controller.inputTarget.value).toBe('/selected/path')
    expect(button.disabled).toBe(false)
  })

  it('shows loading state while picking', async () => {
    global.fetch = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        json: () => Promise.resolve({ path: '/selected/path' })
      }), 100))
    )

    const button = document.querySelector('button')
    const event = { preventDefault: vi.fn(), currentTarget: button }
    const originalText = button.textContent

    controller.pick(event)

    expect(button.textContent).toBe('Opening...')
    expect(button.disabled).toBe(true)
  })

  it('restores button after pick completes', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ path: '/selected/path' })
    })

    const button = document.querySelector('button')
    const originalText = button.textContent
    const event = { preventDefault: vi.fn(), currentTarget: button }

    await controller.pick(event)

    expect(button.textContent).toBe(originalText)
    expect(button.disabled).toBe(false)
  })

  it('handles pick errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const button = document.querySelector('button')
    const event = { preventDefault: vi.fn(), currentTarget: button }

    await controller.pick(event)

    expect(consoleSpy).toHaveBeenCalledWith('Folder picker failed:', expect.any(Error))
    expect(button.disabled).toBe(false)

    consoleSpy.mockRestore()
  })

  it('uses custom URL value', () => {
    document.body.innerHTML = `
      <div data-controller="folder-picker" data-folder-picker-url-value="/custom/url">
        <input type="text" data-folder-picker-target="input">
        <button data-action="click->folder-picker#pick">Pick</button>
      </div>
    `
    const element = document.querySelector('[data-controller="folder-picker"]')
    const customController = application.getControllerForElementAndIdentifier(element, 'folder-picker')

    expect(customController.urlValue).toBe('/custom/url')
  })
})
