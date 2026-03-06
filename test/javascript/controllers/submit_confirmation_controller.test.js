import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import SubmitConfirmationController from '../../../app/javascript/controllers/submit_confirmation_controller.js'

describe('SubmitConfirmationController', () => {
  let application
  let controller

  beforeEach(() => {
    sessionStorage.clear()
    application = Application.start()
    application.register('submit-confirmation', SubmitConfirmationController)
    document.body.innerHTML = `
      <div
        data-controller="submit-confirmation"
        data-submit-confirmation-pr-title-value="Improve tests"
        data-submit-confirmation-pr-number-value="42"
      >
        <dialog data-submit-confirmation-target="dialog">
          <input type="checkbox" data-dont-ask-checkbox>
        </dialog>
        <span data-submit-confirmation-target="prTitle"></span>
        <span data-submit-confirmation-target="prNumber"></span>
        <span data-submit-confirmation-target="commentCount"></span>
        <span data-submit-confirmation-target="severityBreakdown"></span>
        <span data-submit-confirmation-target="warningMessage"></span>
        <form data-submit-confirmation-target="form">
          <input type="hidden" name="event" value="REQUEST_CHANGES">
        </form>
        <div data-severity="major">
          <input type="checkbox" value="1" checked data-comment-checklist-target="checkbox">
        </div>
        <div data-severity="minor">
          <input type="checkbox" value="2" checked data-comment-checklist-target="checkbox">
        </div>
      </div>
    `
    const dialog = document.querySelector('dialog')
    dialog.showModal = vi.fn()
    dialog.close = vi.fn()

    const form = document.querySelector('form')
    form.requestSubmit = vi.fn()

    const element = document.querySelector('[data-controller="submit-confirmation"]')
    controller = application.getControllerForElementAndIdentifier(element, 'submit-confirmation')
  })

  it('connect reads session skip flag', () => {
    sessionStorage.setItem('skipSubmitConfirmation', 'true')
    controller.connect()

    expect(controller.skipConfirmationValue).toBe(true)
  })

  it('showConfirmation allows natural submit when disabled', () => {
    controller.confirmationEnabledValue = false
    const event = { preventDefault: vi.fn() }

    controller.showConfirmation(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(controller.dialogTarget.showModal).not.toHaveBeenCalled()
  })

  it('showConfirmation opens dialog and populates summary', () => {
    const event = { preventDefault: vi.fn() }

    controller.showConfirmation(event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(controller.dialogTarget.showModal).toHaveBeenCalled()
    expect(controller.prTitleTarget.textContent).toBe('Improve tests')
    expect(controller.prNumberTarget.textContent).toBe('#42')
    expect(controller.commentCountTarget.textContent).toBe('2 comments')
    expect(controller.severityBreakdownTarget.textContent).toContain('major')
    expect(controller.warningMessageTarget.textContent).toContain('request changes')
  })

  it('warningText handles approve without comments', () => {
    expect(controller.warningText('APPROVE', 0)).toContain('approve the PR on GitHub without adding review comments')
  })

  it('confirm can persist skip flag and submit form', () => {
    controller.dialogTarget.querySelector('[data-dont-ask-checkbox]').checked = true

    controller.confirm()

    expect(sessionStorage.getItem('skipSubmitConfirmation')).toBe('true')
    expect(controller.dialogTarget.close).toHaveBeenCalled()
    expect(controller.formTarget.requestSubmit).toHaveBeenCalled()
  })

  it('cancel closes dialog', () => {
    controller.cancel()

    expect(controller.dialogTarget.close).toHaveBeenCalled()
  })

  it('handleKeydown closes on escape', () => {
    controller.cancel = vi.fn()

    controller.handleKeydown({ key: 'Escape' })

    expect(controller.cancel).toHaveBeenCalled()
  })

  it('backdropClick closes only for dialog backdrop', () => {
    controller.cancel = vi.fn()

    controller.backdropClick({ target: controller.dialogTarget })
    controller.backdropClick({ target: document.body })

    expect(controller.cancel).toHaveBeenCalledTimes(1)
  })
})
