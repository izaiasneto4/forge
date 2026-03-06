import { describe, it, expect, beforeEach } from 'vitest'
import { Application } from '@hotwired/stimulus'
import EventSelectorController from '../../../app/javascript/controllers/event_selector_controller.js'

describe('EventSelectorController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('event-selector', EventSelectorController)
    document.body.innerHTML = `
      <div data-controller="event-selector">
        <button data-action="click->event-selector#toggle">
          <div data-event-selector-target="selectedIcon">
            <svg class="event-icon"><path d="M1 1"/></svg>
          </div>
          <span data-event-selector-target="selectedLabel">Selected</span>
        </button>
        <div data-event-selector-target="dropdown" class="hidden">
          <div data-action="click->event-selector#select" data-value="event1" data-label="Event 1">
            <div class="event-icon"><svg><path d="M1 1"/></svg></div>
            Event 1
          </div>
          <div data-action="click->event-selector#select" data-value="event2" data-label="Event 2">
            <div class="event-icon"><svg><path d="M2 2"/></svg></div>
            Event 2
          </div>
        </div>
        <input type="hidden" data-event-selector-target="hiddenInput">
      </div>
    `
    const element = document.querySelector('[data-controller="event-selector"]')
    controller = application.getControllerForElementAndIdentifier(element, 'event-selector')
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
  })

  it('selects event', () => {
    const item = controller.element.querySelectorAll("[data-action='click->event-selector#select']")[0]
    const event = { preventDefault: vi.fn(), currentTarget: item }

    controller.select(event)

    expect(controller.hiddenInputTarget.value).toBe('event1')
    expect(controller.selectedLabelTarget.textContent).toBe('Event 1')
    expect(controller.selectedIconTarget.innerHTML).toContain('<svg')
    expect(item.classList.contains('bg-[color:var(--color-bg-tertiary)]')).toBe(true)
  })

  it('updates active state on selection', () => {
    const items = controller.element.querySelectorAll("[data-action='click->event-selector#select']")
    const firstItem = items[0]
    const secondItem = items[1]

    controller.select({ preventDefault: vi.fn(), currentTarget: firstItem })
    controller.select({ preventDefault: vi.fn(), currentTarget: secondItem })

    expect(firstItem.classList.contains('bg-[color:var(--color-bg-tertiary)]')).toBe(false)
    expect(secondItem.classList.contains('bg-[color:var(--color-bg-tertiary)]')).toBe(true)
  })

  it('closes dropdown after selection', () => {
    const item = controller.element.querySelectorAll("[data-action='click->event-selector#select']")[0]
    controller.openValue = true
    controller.updateDropdownVisibility()

    controller.select({ preventDefault: vi.fn(), currentTarget: item })

    expect(controller.openValue).toBe(false)
    expect(controller.dropdownTarget.classList.contains('hidden')).toBe(true)
  })

  it('disconnects and cleans up listeners', () => {
    controller.disconnect()
    expect(controller.openValue).toBe(false)
  })
})
