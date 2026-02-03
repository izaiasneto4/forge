import { describe, it, expect, beforeEach } from 'vitest'
import { Application } from '@hotwired/stimulus'
import ReviewAccordionController from '../../../app/javascript/controllers/review_accordion_controller.js'

describe('ReviewAccordionController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('review-accordion', ReviewAccordionController)
    document.body.innerHTML = `
      <div data-controller="review-accordion">
        <div data-review-accordion-target="item">
          <div data-action="click->review-accordion#toggle">Header 1</div>
        </div>
        <div data-review-accordion-target="item" class="is-expanded">
          <div data-action="click->review-accordion#toggle">Header 2</div>
        </div>
      </div>
    `
    const element = document.querySelector('[data-controller="review-accordion"]')
    controller = application.getControllerForElementAndIdentifier(element, 'review-accordion')
  })

  it('connects with item targets', () => {
    expect(controller.itemTargets.length).toBe(2)
  })

  it('toggles item on click', () => {
    const header = controller.itemTargets[0].querySelector('[data-action*="toggle"]')
    const item = controller.itemTargets[0]

    controller.toggle({ currentTarget: header })

    expect(item.classList.contains('is-expanded')).toBe(true)

    controller.toggle({ currentTarget: header })

    expect(item.classList.contains('is-expanded')).toBe(false)
  })

  it('expands all items', () => {
    controller.itemTargets[0].classList.remove('is-expanded')

    controller.expandAll()

    expect(controller.itemTargets[0].classList.contains('is-expanded')).toBe(true)
    expect(controller.itemTargets[1].classList.contains('is-expanded')).toBe(true)
  })

  it('collapses all items', () => {
    controller.itemTargets.forEach(item => item.classList.add('is-expanded'))

    controller.collapseAll()

    expect(controller.itemTargets[0].classList.contains('is-expanded')).toBe(false)
    expect(controller.itemTargets[1].classList.contains('is-expanded')).toBe(false)
  })
})
