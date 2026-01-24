import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["checkbox", "counter", "submitButton", "selectAllButton", "form"]
  static values = {
    reviewTaskId: Number,
    toggleUrl: { type: String, default: "/review_comments/:id/toggle" }
  }

  connect() {
    this.updateCounter()
    this.updateSubmitButton()
  }

  // Toggle a single comment's selection
  async toggle(event) {
    const checkbox = event.currentTarget
    const commentId = checkbox.dataset.commentId
    const commentElement = checkbox.closest("[data-comment-id]")

    // Optimistically update the UI
    this.updateCounter()
    this.updateSubmitButton()
    this.updateCommentAppearance(commentElement, checkbox.checked)

    // Optionally persist to server if needed
    // For now, we'll just track selection client-side
  }

  // Select all pending comments
  selectAll(event) {
    event.preventDefault()
    this.checkboxTargets.forEach(checkbox => {
      if (!checkbox.disabled) {
        checkbox.checked = true
        const commentElement = checkbox.closest("[data-comment-id]")
        this.updateCommentAppearance(commentElement, true)
      }
    })
    this.updateCounter()
    this.updateSubmitButton()
  }

  // Deselect all comments
  deselectAll(event) {
    event.preventDefault()
    this.checkboxTargets.forEach(checkbox => {
      checkbox.checked = false
      const commentElement = checkbox.closest("[data-comment-id]")
      this.updateCommentAppearance(commentElement, false)
    })
    this.updateCounter()
    this.updateSubmitButton()
  }

  // Toggle between select all / deselect all
  toggleAll(event) {
    event.preventDefault()
    const allChecked = this.allSelected()

    if (allChecked) {
      this.deselectAll(event)
    } else {
      this.selectAll(event)
    }

    this.updateToggleAllButton()
  }

  // Get the count of selected comments
  get selectedCount() {
    return this.checkboxTargets.filter(cb => cb.checked).length
  }

  // Get the total count of selectable comments
  get totalCount() {
    return this.checkboxTargets.filter(cb => !cb.disabled).length
  }

  // Check if all selectable comments are selected
  allSelected() {
    const selectableCheckboxes = this.checkboxTargets.filter(cb => !cb.disabled)
    return selectableCheckboxes.length > 0 &&
           selectableCheckboxes.every(cb => cb.checked)
  }

  // Get the IDs of all selected comments
  get selectedCommentIds() {
    return this.checkboxTargets
      .filter(cb => cb.checked)
      .map(cb => cb.dataset.commentId)
  }

  // Update the counter display
  updateCounter() {
    if (this.hasCounterTarget) {
      this.counterTarget.textContent = `${this.selectedCount} of ${this.totalCount} selected`
    }
  }

  // Update submit button state based on selection
  updateSubmitButton() {
    if (this.hasSubmitButtonTarget) {
      const hasSelection = this.selectedCount > 0
      this.submitButtonTarget.disabled = !hasSelection

      if (hasSelection) {
        this.submitButtonTarget.classList.remove("opacity-50", "cursor-not-allowed")
      } else {
        this.submitButtonTarget.classList.add("opacity-50", "cursor-not-allowed")
      }
    }
  }

  // Update the toggle all button text
  updateToggleAllButton() {
    if (this.hasSelectAllButtonTarget) {
      const allChecked = this.allSelected()
      this.selectAllButtonTarget.textContent = allChecked ? "Deselect All" : "Select All"
    }
  }

  // Update visual appearance of a comment based on selection
  updateCommentAppearance(commentElement, isSelected) {
    if (!commentElement) return

    if (isSelected) {
      commentElement.classList.add("is-selected")
    } else {
      commentElement.classList.remove("is-selected")
    }
  }

  // Collect form data for submission
  getSubmissionData() {
    return {
      comment_ids: this.selectedCommentIds,
      review_task_id: this.reviewTaskIdValue
    }
  }

  // Handle keyboard shortcuts
  keydown(event) {
    // Ctrl/Cmd + A to select all
    if ((event.ctrlKey || event.metaKey) && event.key === "a") {
      event.preventDefault()
      this.selectAll(event)
    }
    // Escape to deselect all
    if (event.key === "Escape") {
      this.deselectAll(event)
    }
  }

  // Prepare form submission by adding selected comment IDs as hidden inputs
  prepareSubmission(event) {
    if (!this.hasFormTarget) return

    // Remove any existing comment_ids inputs
    this.formTarget.querySelectorAll('input[name="comment_ids[]"]').forEach(input => input.remove())

    // Add hidden inputs for each selected comment ID
    this.selectedCommentIds.forEach(id => {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = 'comment_ids[]'
      input.value = id
      this.formTarget.appendChild(input)
    })
  }
}
