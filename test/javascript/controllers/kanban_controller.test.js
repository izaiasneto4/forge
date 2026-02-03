import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import KanbanController from '../../../app/javascript/controllers/kanban_controller.js'

describe('KanbanController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('kanban', KanbanController)
    document.body.innerHTML = `
      <div data-controller="kanban">
        <div data-kanban-target="column" data-status="pending_review">
          <div data-kanban-target="card" draggable="true" data-pr-id="1">PR #1</div>
        </div>
        <div data-kanban-target="column" data-status="in_review"></div>
        <div data-kanban-target="column" data-status="reviewed_by_me"></div>
      </div>
    `
    const element = document.querySelector('[data-controller="kanban"]')
    controller = application.getControllerForElementAndIdentifier(element, 'kanban')
  })

  it('connects and initializes drag listeners', () => {
    expect(controller).toBeDefined()
    expect(controller.columnTargets.length).toBe(3)
  })

  it('handles drag start', () => {
    const card = controller.cardTargets[0]
    const event = new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: new DataTransfer()
    })

    card.dispatchEvent(event)
    expect(controller.draggedCard).toBe(card)
    expect(card.classList.contains('opacity-50')).toBe(true)
  })

  it('handles drag end', () => {
    const card = controller.cardTargets[0]
    card.classList.add('opacity-50')

    const event = new DragEvent('dragend', { bubbles: true })
    card.dispatchEvent(event)

    expect(card.classList.contains('opacity-50')).toBe(false)
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
    expect(column.classList.contains('bg-blue-50')).toBe(true)
  })

  it('handles drag leave', () => {
    const column = controller.columnTargets[0]
    column.classList.add('bg-blue-50', 'ring-2', 'ring-blue-300')

    const event = new DragEvent('dragleave', {
      bubbles: true,
      relatedTarget: document.body
    })

    column.dispatchEvent(event)
    expect(column.classList.contains('bg-blue-50')).toBe(false)
  })

  it('handles drop and updates status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<turbo-stream>test</turbo-stream>')
    })

    const card = controller.cardTargets[0]
    controller.draggedCard = card
    card.setAttribute('data-pr-id', '1')

    const column = controller.columnTargets[1]
    column.setAttribute('data-status', 'in_review')

    const event = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: new DataTransfer()
    })
    event.dataTransfer.setData('text/plain', '1')

    column.dispatchEvent(event)

    await new Promise(resolve => setTimeout(resolve, 100))
    expect(global.fetch).toHaveBeenCalledWith(
      '/pull_requests/1/update_status',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.any(String)
      })
    )
  })

  it('marks as reviewed', () => {
    const card = controller.cardTargets[0]
    card.setAttribute('data-pr-id', '1')

    const currentColumn = controller.columnTargets[0]
    currentColumn.setAttribute('data-status', 'pending_review')

    const reviewedColumn = controller.columnTargets[2]
    reviewedColumn.setAttribute('data-status', 'reviewed_by_me')

    card.id = 'pull_request_card_1'

    const event = new Event('click')
    Object.defineProperty(event, 'currentTarget', {
      get: () => ({ dataset: { prId: '1' } })
    })

    controller.updateStatus = vi.fn()

    controller.markAsReviewed(event)
    expect(controller.updateStatus).toHaveBeenCalledWith('1', 'reviewed_by_me')
  })

  it('updates column counts', () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'bg-white'

    const badge = document.createElement('span')
    badge.className = 'text-xs px-2 py-1 rounded-full'
    badge.textContent = '0'

    wrapper.appendChild(badge)
    controller.columnTargets[0].appendChild(wrapper)

    controller.updateColumnCounts()

    expect(badge.textContent).toBe('1')
  })
})
