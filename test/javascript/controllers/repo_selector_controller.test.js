import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import RepoSelectorController from '../../../app/javascript/controllers/repo_selector_controller.js'

describe('RepoSelectorController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('repo-selector', RepoSelectorController)
    document.body.innerHTML = `
      <div data-controller="repo-selector">
        <button data-repo-selector-target="button" data-action="click->repo-selector#toggle">
          <span data-repo-selector-target="currentRepoName">Current Repo</span>
          <div data-repo-selector-target="loading" class="hidden">Loading...</div>
        </button>
        <div data-repo-selector-target="dropdown" class="hidden">
          <a data-repo-path="owner/repo1" data-repo-name="owner/repo1" data-action="click->repo-selector#selectRepo">Repo 1</a>
          <a data-repo-path="owner/repo2" data-repo-name="owner/repo2" data-action="click->repo-selector#selectRepo">Repo 2</a>
        </div>
      </div>
    `
    const element = document.querySelector('[data-controller="repo-selector"]')
    controller = application.getControllerForElementAndIdentifier(element, 'repo-selector')
  })

  it('connects and sets up click outside listener', () => {
    expect(controller).toBeDefined()
    expect(controller.openValue).toBe(false)
  })

  it('toggles dropdown', () => {
    const event = { stopPropagation: vi.fn() }
    controller.toggle(event)

    expect(controller.openValue).toBe(true)
    expect(controller.dropdownTarget.classList.contains('hidden')).toBe(false)
  })

  it('closes dropdown when clicking outside', () => {
    controller.openValue = true
    controller.updateDropdownVisibility()

    const event = { target: document.body }
    controller.closeOnClickOutside(event)

    expect(controller.openValue).toBe(false)
    expect(controller.dropdownTarget.classList.contains('hidden')).toBe(true)
  })

  it('does not close when clicking inside', () => {
    controller.openValue = true
    controller.updateDropdownVisibility()

    const event = { target: controller.element }
    controller.closeOnClickOutside(event)

    expect(controller.openValue).toBe(true)
  })

  it('selects repo', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/vnd.turbo-stream.html' },
      text: () => Promise.resolve('<turbo-stream>test</turbo-stream>')
    })

    const repoLink = controller.element.querySelector('[data-action*="selectRepo"]')
    const event = { preventDefault: vi.fn(), currentTarget: repoLink }
    const originalName = controller.currentRepoNameTarget.textContent

    await controller.selectRepo(event)

    expect(controller.currentRepoNameTarget.textContent).toBe(originalName)
    expect(global.fetch).toHaveBeenCalledWith(
      '/repositories/switch',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('shows loading state during selection', async () => {
    global.fetch = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        headers: { get: () => 'text/vnd.turbo-stream.html' },
        text: () => Promise.resolve('')
      }), 100))
    )

    const repoLink = controller.element.querySelector('[data-action*="selectRepo"]')
    const event = { preventDefault: vi.fn(), currentTarget: repoLink }

    controller.selectRepo(event)

    expect(controller.loadingTarget.classList.contains('hidden')).toBe(false)
  })

  it('hides loading state after selection', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/vnd.turbo-stream.html' },
      text: () => Promise.resolve('')
    })

    const repoLink = controller.element.querySelector('[data-action*="selectRepo"]')
    const event = { preventDefault: vi.fn(), currentTarget: repoLink }

    await controller.selectRepo(event)

    expect(controller.loadingTarget.classList.contains('hidden')).toBe(true)
  })

  it('disconnects and cleans up listeners', () => {
    controller.disconnect()
    expect(controller.openValue).toBe(false)
  })
})
