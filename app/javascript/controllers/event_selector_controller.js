import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["button", "dropdown", "hiddenInput", "selectedIcon", "selectedLabel"]
  static values = {
    open: { type: Boolean, default: false }
  }

  connect() {
    this.boundCloseOnClickOutside = this.closeOnClickOutside.bind(this)
    document.addEventListener("click", this.boundCloseOnClickOutside)
  }

  disconnect() {
    document.removeEventListener("click", this.boundCloseOnClickOutside)
  }

  toggle(event) {
    event.stopPropagation()
    this.openValue = !this.openValue
    this.updateDropdownVisibility()
  }

  closeOnClickOutside(event) {
    if (!this.element.contains(event.target) && this.openValue) {
      this.openValue = false
      this.updateDropdownVisibility()
    }
  }

  updateDropdownVisibility() {
    if (this.hasDropdownTarget) {
      this.dropdownTarget.classList.toggle("hidden", !this.openValue)
    }
  }

  select(event) {
    event.preventDefault()
    const item = event.currentTarget
    const value = item.dataset.value
    const label = item.dataset.label
    const iconHtml = item.querySelector(".event-icon").innerHTML

    // Update hidden input
    this.hiddenInputTarget.value = value

    // Update button display
    this.selectedIconTarget.innerHTML = iconHtml
    this.selectedLabelTarget.textContent = label

    // Update active states
    this.element.querySelectorAll("[data-action='click->event-selector#select']").forEach(el => {
      el.classList.remove("bg-[color:var(--color-bg-tertiary)]")
    })
    item.classList.add("bg-[color:var(--color-bg-tertiary)]")

    // Close dropdown
    this.openValue = false
    this.updateDropdownVisibility()
  }
}
