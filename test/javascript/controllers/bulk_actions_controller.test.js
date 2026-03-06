import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import BulkActionsController from '../../../app/javascript/controllers/bulk_actions_controller.js'

describe('BulkActionsController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('bulk-actions', BulkActionsController)
    document.body.innerHTML = `
      <div data-controller="bulk-actions">
        <div class="toolbar hidden" data-bulk-actions-target="toolbar">
          <span data-bulk-actions-target="count">0</span>
          <button data-bulk-actions-target="deleteButton" data-action="click->bulk-actions#showDeleteModal">Delete</button>
        </div>
        <div class="modal hidden" data-bulk-actions-target="modal"></div>
        <label>
          <input type="checkbox" data-bulk-actions-target="checkbox" value="1" data-action="change->bulk-actions#updateSelection">
          PR 1
        </label>
        <label>
          <input type="checkbox" data-bulk-actions-target="checkbox" value="2" data-action="change->bulk-actions#updateSelection">
          PR 2
        </label>
        <label>
          <input type="checkbox" data-bulk-actions-target="selectAll" data-action="change->bulk-actions#toggleAll">
          Select All
        </label>
      </div>
    `
    const element = document.querySelector('[data-controller="bulk-actions"]')
    controller = application.getControllerForElementAndIdentifier(element, 'bulk-actions')
  })

  it('connects and initializes', () => {
    expect(controller).toBeDefined()
    expect(controller.selectedValue).toEqual([])
  })

  it('toggles all checkboxes', () => {
    controller.selectAllTarget.checked = true
    const event = { target: controller.selectAllTarget }

    controller.toggleAll(event)

    expect(controller.checkboxTargets[0].checked).toBe(true)
    expect(controller.checkboxTargets[1].checked).toBe(true)
  })

  it('deselects all when all are selected', () => {
    controller.checkboxTargets.forEach(cb => cb.checked = true)
    controller.selectAllTarget.checked = false
    const event = { target: controller.selectAllTarget }

    controller.toggleAll(event)

    expect(controller.checkboxTargets[0].checked).toBe(false)
    expect(controller.checkboxTargets[1].checked).toBe(false)
  })

  it('updates selection when checkbox changes', () => {
    controller.checkboxTargets[0].checked = true

    controller.updateSelection()

    expect(controller.selectedValue).toEqual(['1'])
  })

  it('shows toolbar when items are selected', () => {
    controller.checkboxTargets[0].checked = true
    controller.updateSelection()

    expect(controller.toolbarTarget.classList.contains('hidden')).toBe(false)
  })

  it('hides toolbar when no items selected', () => {
    controller.updateSelection()

    expect(controller.toolbarTarget.classList.contains('hidden')).toBe(true)
  })

  it('updates count display', () => {
    controller.checkboxTargets[0].checked = true
    controller.checkboxTargets[1].checked = true
    controller.updateSelection()

    expect(controller.countTarget.textContent).toBe('2')
  })

  it('enables delete button when items selected', () => {
    controller.checkboxTargets[0].checked = true
    controller.updateSelection()

    expect(controller.deleteButtonTarget.disabled).toBe(false)
  })

  it('disables delete button when no items selected', () => {
    controller.updateSelection()

    expect(controller.deleteButtonTarget.disabled).toBe(true)
  })

  it('shows select all as indeterminate when some selected', () => {
    controller.checkboxTargets[0].checked = true
    controller.updateSelection()

    expect(controller.selectAllTarget.checked).toBe(false)
    expect(controller.selectAllTarget.indeterminate).toBe(true)
  })

  it('shows select all as checked when all selected', () => {
    controller.checkboxTargets.forEach(cb => cb.checked = true)
    controller.updateSelection()

    expect(controller.selectAllTarget.checked).toBe(true)
    expect(controller.selectAllTarget.indeterminate).toBe(false)
  })

  it('shows delete modal', () => {
    controller.selectedValue = ['1', '2']

    controller.showDeleteModal()

    expect(controller.modalTarget.classList.contains('hidden')).toBe(false)
  })

  it('does not show delete modal when no items selected', () => {
    controller.selectedValue = []

    controller.showDeleteModal()

    expect(controller.modalTarget.classList.contains('hidden')).toBe(true)
  })

  it('hides delete modal', () => {
    controller.modalTarget.classList.remove('hidden')

    controller.hideDeleteModal()

    expect(controller.modalTarget.classList.contains('hidden')).toBe(true)
  })

  it('confirms delete', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<turbo-stream>test</turbo-stream>')
    })

    controller.selectedValue = ['1', '2']
    controller.modalTarget.classList.remove('hidden')

    await controller.confirmDelete()

    expect(global.fetch).toHaveBeenCalledWith(
      '/pull_requests/bulk_destroy',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ pull_request_ids: ['1', '2'] })
      })
    )
    expect(controller.modalTarget.classList.contains('hidden')).toBe(true)
  })

  it('updates UI when selected value changes', () => {
    controller.selectedValue = ['1', '2']
    controller.selectedValueChanged()

    expect(controller.toolbarTarget.classList.contains('hidden')).toBe(false)
    expect(controller.countTarget.textContent).toBe('2')
  })

  it('stops event propagation', () => {
    const event = { stopPropagation: vi.fn() }

    controller.stopPropagation(event)

    expect(event.stopPropagation).toHaveBeenCalled()
  })
})
