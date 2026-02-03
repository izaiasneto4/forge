import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import ReviewKanbanController from '../../../app/javascript/controllers/review_kanban_controller.js'

describe('ReviewKanbanController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('review-kanban', ReviewKanbanController)
    document.body.innerHTML = `
      <div data-controller="review-kanban">
        <div data-review-kanban-target="column" data-state="pending_review">
          <div data-task-id="1" data-current-state="pending_review" class="kanban-card">
            <h3>Task 1</h3>
          </div>
        </div>
        <div data-review-kanban-target="column" data-state="in_review"></div>
        <div data-review-kanban-target="column" data-state="reviewed"></div>
      </div>
    `
    const element = document.querySelector('[data-controller="review-kanban"]')
    controller = application.getControllerForElementAndIdentifier(element, 'review-kanban')
  })

  it('connects and initializes', () => {
    expect(controller).toBeDefined()
    expect(controller.columnTargets.length).toBe(3)
    expect(controller.draggedCard).toBe(null)
  })

  it('creates announcer element', () => {
    const announcer = document.getElementById('kanban-announcer')
    expect(announcer).toBeDefined()
    expect(announcer.getAttribute('aria-live')).toBe('assertive')
  })

  it('announces messages', () => {
    controller.announce('Test message')

    const announcer = document.getElementById('kanban-announcer')
    expect(announcer.textContent).toBe('Test message')
  })

  it('handles drag start', () => {
    const card = document.querySelector('[data-task-id="1"]')
    const event = new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: new DataTransfer()
    })

    card.dispatchEvent(event)

    expect(controller.draggedCard).toBe(card)
    expect(card.classList.contains('kanban-card--dragging')).toBe(true)
  })

  it('handles drag end', () => {
    const card = document.querySelector('[data-task-id="1"]')
    card.classList.add('kanban-card--dragging')

    const event = new DragEvent('dragend', { bubbles: true })
    card.dispatchEvent(event)

    expect(card.classList.contains('kanban-card--dragging')).toBe(false)
  })

  it('handles drag over', () => {
    const column = controller.columnTargets[0]
    const event = new DragEvent('dragover', {
      bubbles: true,
      cancelable: true
    })

    column.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('handles drag enter', () => {
    const column = controller.columnTargets[0]
    const event = new DragEvent('dragenter', {
      bubbles: true,
      cancelable: true
    })

    column.dispatchEvent(event)

    expect(column.classList.contains('kanban-dropzone--active')).toBe(true)
  })

  it('handles drag leave', () => {
    const column = controller.columnTargets[0]
    column.classList.add('kanban-dropzone--active')

    const event = new DragEvent('dragleave', {
      bubbles: true,
      relatedTarget: document.body
    })

    column.dispatchEvent(event)

    expect(column.classList.contains('kanban-dropzone--active')).toBe(false)
  })

  it('handles drop and updates state', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<turbo-stream>test</turbo-stream>')
    })

    const card = document.querySelector('[data-task-id="1"]')
    controller.draggedCard = card

    const column = controller.columnTargets[1]

    const event = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: new DataTransfer()
    })
    event.dataTransfer.setData('text/plain', '1')

    column.dispatchEvent(event)

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(global.fetch).toHaveBeenCalled()
  })

  it('detects backward movement', () => {
    expect(controller.isBackwardMovement('reviewed', 'pending_review')).toBe(true)
    expect(controller.isBackwardMovement('pending_review', 'reviewed')).toBe(false)
    expect(controller.isBackwardMovement('in_review', 'pending_review')).toBe(true)
  })

  it('handles keyboard navigation - Enter', () => {
    const card = document.querySelector('[data-task-id="1"]')
    const event = { key: 'Enter', preventDefault: vi.fn(), target: card }

    controller.toggleKeyboardMove(card)

    expect(card.classList.contains('kanban-card--keyboard-moving')).toBe(true)
  })

  it('handles keyboard navigation - Escape', () => {
    const card = document.querySelector('[data-task-id="1"]')
    controller.keyboardMovingCard = card
    card.classList.add('kanban-card--keyboard-moving')

    const event = { key: 'Escape', preventDefault: vi.fn(), target: card }

    controller.handleKeydown(event)

    expect(card.classList.contains('kanban-card--keyboard-moving')).toBe(false)
  })

  it('moves to adjacent column with arrow keys', () => {
    const card = document.querySelector('[data-task-id="1"]')
    controller.keyboardMovingCard = card

    const event = { key: 'ArrowRight', preventDefault: vi.fn(), target: card }

    controller.handleKeydown(event)

    const currentColumn = card.closest('[data-review-kanban-target="column"]')
    expect(currentColumn.dataset.state).toBe('in_review')
  })

  it('shows backward confirmation', () => {
    const card = document.querySelector('[data-task-id="1"]')
    controller.pendingMove = {
      taskId: '1',
      newState: 'pending_review',
      card: card
    }

    document.body.innerHTML = `
      <div data-review-kanban-target="confirmModal" class="hidden"></div>
      <div data-review-kanban-target="confirmModalContent"></div>
    `
    const element = document.querySelector('[data-controller="review-kanban"]')
    const newController = application.getControllerForElementAndIdentifier(element, 'review-kanban')

    newController.showBackwardConfirmation('reviewed', 'pending_review')

    expect(newController.confirmModalTarget.classList.contains('hidden')).toBe(false)
  })

  it('cancels backward move', () => {
    const card = document.querySelector('[data-task-id="1"]')

    controller.pendingMove = {
      card: card,
      originalPosition: {
        parent: controller.columnTargets[0],
        nextSibling: null,
        state: 'pending_review'
      }
    }

    document.body.innerHTML = `
      <div data-review-kanban-target="confirmModal"></div>
    `
    const element = document.querySelector('[data-controller="review-kanban"]')
    const newController = application.getControllerForElementAndIdentifier(element, 'review-kanban')

    newController.pendingMove = controller.pendingMove

    newController.cancelBackwardMove()

    expect(newController.confirmModalTarget.classList.contains('hidden')).toBe(true)
  })

  it('format state label', () => {
    expect(controller.formatStateLabel('pending_review')).toBe('Pending Review')
    expect(controller.formatStateLabel('in_review')).toBe('In Review')
    expect(controller.formatStateLabel('waiting_implementation')).toBe('Waiting Implementation')
  })

  it('rolls back move on error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const card = document.querySelector('[data-task-id="1"]')
    controller.originalPosition = {
      parent: controller.columnTargets[0],
      nextSibling: null,
      state: 'pending_review'
    }

    await controller.updateState('1', 'in_review')

    expect(card.closest('[data-review-kanban-target="column"]').dataset.state).toBe('pending_review')
  })

  it('disconnects and cleans up', () => {
    controller.disconnect()

    const announcer = document.getElementById('kanban-announcer')
    expect(announcer).toBe(null)
  })
})
