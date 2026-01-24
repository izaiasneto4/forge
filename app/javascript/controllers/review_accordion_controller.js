import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["item"]

  connect() {
    // Initially expand only the last (current) review section
    // Historical reviews start collapsed
  }

  toggle(event) {
    const header = event.currentTarget
    const item = header.closest("[data-review-accordion-target='item']")

    if (item) {
      item.classList.toggle("is-expanded")
    }
  }

  expandAll() {
    this.itemTargets.forEach(item => {
      item.classList.add("is-expanded")
    })
  }

  collapseAll() {
    this.itemTargets.forEach(item => {
      item.classList.remove("is-expanded")
    })
  }
}
