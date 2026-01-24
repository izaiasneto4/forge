import { Controller } from "@hotwired/stimulus"
import * as Turbo from "@hotwired/turbo"

export default class extends Controller {
  static targets = ["checkbox", "selectAll", "toolbar", "deleteButton", "count", "modal"]
  static values = { selected: Array }

  connect() {
    this.updateUI()
  }

  toggleAll(event) {
    const checked = event.target.checked
    this.checkboxTargets.forEach(checkbox => {
      checkbox.checked = checked
    })
    this.updateSelection()
  }

  updateSelection() {
    const checkedBoxes = this.checkboxTargets.filter(cb => cb.checked)
    this.selectedValue = checkedBoxes.map(cb => cb.value)
    this.updateUI()
  }

  updateUI() {
    const count = this.selectedValue.length
    const hasSelection = count > 0

    // Update toolbar visibility
    if (this.hasToolbarTarget) {
      this.toolbarTarget.classList.toggle("hidden", !hasSelection)
    }

    // Update count
    if (this.hasCountTarget) {
      this.countTarget.textContent = count
    }

    // Update select all checkbox state
    if (this.hasSelectAllTarget) {
      const allChecked = this.checkboxTargets.length > 0 &&
                        this.checkboxTargets.every(cb => cb.checked)
      const someChecked = this.checkboxTargets.some(cb => cb.checked)

      this.selectAllTarget.checked = allChecked
      this.selectAllTarget.indeterminate = someChecked && !allChecked
    }

    // Update delete button state
    if (this.hasDeleteButtonTarget) {
      this.deleteButtonTarget.disabled = !hasSelection
    }
  }

  showDeleteModal() {
    if (this.selectedValue.length === 0) return

    if (this.hasModalTarget) {
      this.modalTarget.classList.remove("hidden")
    }
  }

  hideDeleteModal() {
    if (this.hasModalTarget) {
      this.modalTarget.classList.add("hidden")
    }
  }

  async confirmDelete() {
    if (this.selectedValue.length === 0) {
      this.hideDeleteModal()
      return
    }

    try {
      const response = await fetch("/pull_requests/bulk_destroy", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/vnd.turbo-stream.html",
          "X-CSRF-Token": document.querySelector("[name='csrf-token']").content
        },
        body: JSON.stringify({ pull_request_ids: this.selectedValue })
      })

      if (response.ok) {
        const html = await response.text()
        Turbo.renderStreamMessage(html)
        this.selectedValue = []
        this.updateUI()
        this.hideDeleteModal()
      } else {
        console.error("Failed to delete pull requests")
        this.hideDeleteModal()
      }
    } catch (error) {
      console.error("Error deleting pull requests:", error)
      this.hideDeleteModal()
    }
  }

  selectedValueChanged() {
    this.updateUI()
  }

  stopPropagation(event) {
    event.stopPropagation()
  }
}
