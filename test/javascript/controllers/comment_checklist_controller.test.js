import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import CommentChecklistController from '../../../app/javascript/controllers/comment_checklist_controller.js'

describe('CommentChecklistController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('comment-checklist', CommentChecklistController)
    document.body.innerHTML = `
      <div data-controller="comment-checklist" data-comment-checklist-review-task-id-value="1">
        <div data-comment-id="1">
          <input type="checkbox" data-comment-checklist-target="checkbox" data-comment-id="1">
          Comment 1
        </div>
        <div data-comment-id="2">
          <input type="checkbox" data-comment-checklist-target="checkbox" data-comment-id="2">
          Comment 2
        </div>
        <div data-comment-id="3">
          <input type="checkbox" data-comment-checklist-target="checkbox" data-comment-id="3" disabled>
          Comment 3
        </div>
        <span data-comment-checklist-target="counter"></span>
        <button data-comment-checklist-target="submitButton">Submit</button>
        <button data-comment-checklist-target="selectAllButton">Select All</button>
        <form data-comment-checklist-target="form">
          <input type="hidden" name="event" value="COMMENT">
        </form>
      </div>
    `
    const element = document.querySelector('[data-controller="comment-checklist"]')
    controller = application.getControllerForElementAndIdentifier(element, 'comment-checklist')
  })

  it('connects and initializes', () => {
    expect(controller).toBeDefined()
    expect(controller.selectedCount).toBe(0)
    expect(controller.totalCount).toBe(2)
  })

  it('toggles checkbox', async () => {
    const checkbox = controller.checkboxTargets[0]
    checkbox.checked = true
    const event = { currentTarget: checkbox, preventDefault: vi.fn() }

    await controller.toggle(event)

    expect(checkbox.checked).toBe(true)
  })

  it('selects all checkboxes', () => {
    const event = { preventDefault: vi.fn() }
    controller.selectAll(event)

    expect(controller.checkboxTargets[0].checked).toBe(true)
    expect(controller.checkboxTargets[1].checked).toBe(true)
    expect(controller.checkboxTargets[2].checked).toBe(false)
  })

  it('deselects all checkboxes', () => {
    controller.checkboxTargets.forEach(cb => cb.checked = true)

    const event = { preventDefault: vi.fn() }
    controller.deselectAll(event)

    expect(controller.checkboxTargets[0].checked).toBe(false)
    expect(controller.checkboxTargets[1].checked).toBe(false)
  })

  it('toggles all checkboxes', () => {
    const event = { preventDefault: vi.fn() }

    controller.toggleAll(event)
    expect(controller.allSelected()).toBe(true)

    controller.toggleAll(event)
    expect(controller.allSelected()).toBe(false)
  })

  it('calculates selected count', () => {
    expect(controller.selectedCount).toBe(0)

    controller.checkboxTargets[0].checked = true
    expect(controller.selectedCount).toBe(1)
  })

  it('calculates total count', () => {
    expect(controller.totalCount).toBe(2)
  })

  it('checks if all selected', () => {
    expect(controller.allSelected()).toBe(false)

    controller.checkboxTargets[0].checked = true
    controller.checkboxTargets[1].checked = true
    expect(controller.allSelected()).toBe(true)
  })

  it('gets selected comment IDs', () => {
    controller.checkboxTargets[0].checked = true
    controller.checkboxTargets[1].checked = true

    const ids = controller.selectedCommentIds
    expect(ids).toEqual(['1', '2'])
  })

  it('updates counter display', () => {
    controller.checkboxTargets[0].checked = true
    controller.updateCounter()

    expect(controller.counterTarget.textContent).toBe('1 of 2 selected')
  })

  it('updates submit button state', () => {
    controller.updateSubmitButton()
    expect(controller.submitButtonTarget.disabled).toBe(true)

    controller.checkboxTargets[0].checked = true
    controller.updateSubmitButton()
    expect(controller.submitButtonTarget.disabled).toBe(false)
  })

  it('enables submit with zero selection when event is APPROVE', () => {
    const eventInput = controller.formTarget.querySelector('input[name="event"]')
    eventInput.value = 'APPROVE'

    controller.updateSubmitButton()
    expect(controller.submitButtonTarget.disabled).toBe(false)
  })

  it('updates toggle all button text', () => {
    controller.checkboxTargets[0].checked = true
    controller.checkboxTargets[1].checked = true
    controller.updateToggleAllButton()

    expect(controller.selectAllButtonTarget.textContent).toBe('Deselect All')
  })

  it('updates comment appearance when selected', () => {
    const commentElement = document.querySelector('[data-comment-id="1"]')

    controller.updateCommentAppearance(commentElement, true)
    expect(commentElement.classList.contains('is-selected')).toBe(true)

    controller.updateCommentAppearance(commentElement, false)
    expect(commentElement.classList.contains('is-selected')).toBe(false)
  })

  it('gets submission data', () => {
    controller.checkboxTargets[0].checked = true
    controller.checkboxTargets[1].checked = true

    const data = controller.getSubmissionData()
    expect(data).toEqual({
      comment_ids: ['1', '2'],
      review_task_id: 1
    })
  })

  it('handles Ctrl+A to select all', () => {
    const event = {
      ctrlKey: true,
      key: 'a',
      preventDefault: vi.fn()
    }

    controller.selectAll = vi.fn()
    controller.keydown(event)

    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('handles Escape to deselect all', () => {
    const event = {
      key: 'Escape',
      preventDefault: vi.fn()
    }

    controller.deselectAll = vi.fn()
    controller.keydown(event)

    expect(controller.deselectAll).toHaveBeenCalledWith(event)
  })

  it('prepares form submission', () => {
    controller.checkboxTargets[0].checked = true
    controller.checkboxTargets[1].checked = true

    controller.prepareSubmission()

    const inputs = controller.formTarget.querySelectorAll('input[name="comment_ids[]"]')
    expect(inputs.length).toBe(2)
  })

  it('prepares force_empty_submission for approve without selected comments', () => {
    const eventInput = controller.formTarget.querySelector('input[name="event"]')
    eventInput.value = 'APPROVE'

    controller.prepareSubmission()

    const forceEmptyInput = controller.formTarget.querySelector('input[name="force_empty_submission"]')
    expect(forceEmptyInput).toBeTruthy()
    expect(forceEmptyInput.value).toBe('true')
  })
})
