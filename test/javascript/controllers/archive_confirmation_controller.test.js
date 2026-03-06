import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import ArchiveConfirmationController from '../../../app/javascript/controllers/archive_confirmation_controller.js'

describe('ArchiveConfirmationController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('archive-confirmation', ArchiveConfirmationController)
    document.body.innerHTML = `
      <div data-controller="archive-confirmation">
        <div data-archive-confirmation-target="modal" class="hidden"></div>
        <form data-archive-confirmation-target="form" action="">
          <input type="hidden" data-archive-confirmation-target="methodInput" value="">
        </form>
        <span data-archive-confirmation-target="itemType"></span>
        <span data-archive-confirmation-target="itemTypeLabel"></span>
        <button
          data-archive-url="/pull_requests/1/archive"
          data-archive-item-type="pull request"
          data-archive-item-type-label="Pull Request"
        ></button>
      </div>
    `
    const element = document.querySelector('[data-controller="archive-confirmation"]')
    controller = application.getControllerForElementAndIdentifier(element, 'archive-confirmation')
  })

  it('opens modal with archive metadata', () => {
    const button = controller.element.querySelector('button')

    controller.open({ currentTarget: button })

    expect(controller.methodInputTarget.value).toBe('patch')
    expect(controller.itemTypeTarget.textContent).toBe('pull request')
    expect(controller.itemTypeLabelTarget.textContent).toBe('Pull Request')
    expect(controller.formTarget.action).toContain('/pull_requests/1/archive')
    expect(controller.modalTarget.classList.contains('hidden')).toBe(false)
  })

  it('uses fallback labels when dataset values are missing', () => {
    const button = document.createElement('button')
    button.dataset.archiveUrl = '/review_tasks/2/archive'

    controller.open({ currentTarget: button })

    expect(controller.itemTypeTarget.textContent).toBe('item')
    expect(controller.itemTypeLabelTarget.textContent).toBe('item')
  })

  it('closes the modal', () => {
    controller.modalTarget.classList.remove('hidden')

    controller.close()

    expect(controller.modalTarget.classList.contains('hidden')).toBe(true)
  })

  it('stops propagation', () => {
    const event = { stopPropagation: vi.fn() }

    controller.stopPropagation(event)

    expect(event.stopPropagation).toHaveBeenCalled()
  })
})
