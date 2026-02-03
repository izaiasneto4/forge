import { Controller } from "@hotwired/stimulus"

/**
 * Submit Confirmation Controller
 *
 * Displays a confirmation dialog before submitting a review to GitHub.
 * Shows summary of what will be submitted: PR title, comment counts, severity breakdown.
 */
export default class extends Controller {
  static targets = ["dialog", "prTitle", "prNumber", "commentCount", "severityBreakdown", "form"]
  static values = {
    prTitle: String,
    prNumber: Number,
    confirmationEnabled: { type: Boolean, default: true },  // Server-side setting
    skipConfirmation: { type: Boolean, default: false }     // Session preference
  }

  connect() {
    // Check if user has opted to skip confirmation for this session
    this.skipConfirmationValue = sessionStorage.getItem("skipSubmitConfirmation") === "true"
  }

  // Called when user clicks the submit button
  showConfirmation(event) {
    // If confirmation is disabled via settings, proceed directly
    if (!this.confirmationEnabledValue) {
      return // Let the form submit naturally
    }

    // If skip confirmation is enabled for this session, proceed directly
    if (this.skipConfirmationValue) {
      return // Let the form submit naturally
    }

    event.preventDefault()

    // Update dialog content
    this.updateDialogContent()

    // Show the dialog
    this.dialogTarget.showModal()
  }

  updateDialogContent() {
    const checkboxes = this.element.querySelectorAll('[data-comment-checklist-target="checkbox"]:checked')
    const selectedIds = Array.from(checkboxes).map(cb => cb.value)

    // Count comments by severity
    const severityCounts = {}
    checkboxes.forEach(cb => {
      const card = cb.closest('[data-severity]')
      if (card) {
        const severity = card.dataset.severity
        severityCounts[severity] = (severityCounts[severity] || 0) + 1
      }
    })

    // Update PR info
    if (this.hasPrTitleTarget) {
      this.prTitleTarget.textContent = this.prTitleValue
    }
    if (this.hasPrNumberTarget) {
      this.prNumberTarget.textContent = `#${this.prNumberValue}`
    }

    // Update comment count
    if (this.hasCommentCountTarget) {
      this.commentCountTarget.textContent = `${selectedIds.length} comment${selectedIds.length !== 1 ? 's' : ''}`
    }

    // Update severity breakdown
    if (this.hasSeverityBreakdownTarget) {
      this.updateSeverityBreakdown(severityCounts)
    }
  }

  updateSeverityBreakdown(counts) {
    const severityOrder = ['critical', 'major', 'minor', 'suggestion', 'nitpick']
    const severityEmoji = {
      critical: '🚨',
      major: '⚠️',
      minor: 'ℹ️',
      suggestion: '💡',
      nitpick: '🔍'
    }

    const parts = []
    severityOrder.forEach(severity => {
      if (counts[severity]) {
        parts.push(`${severityEmoji[severity]} ${counts[severity]} ${severity}`)
      }
    })

    this.severityBreakdownTarget.textContent = parts.length > 0 ? parts.join(', ') : 'No severity data'
  }

  // Called when user confirms submission
  confirm() {
    // Check if "don't ask again" is checked
    const dontAskCheckbox = this.dialogTarget.querySelector('[data-dont-ask-checkbox]')
    if (dontAskCheckbox?.checked) {
      sessionStorage.setItem("skipSubmitConfirmation", "true")
      this.skipConfirmationValue = true
    }

    this.dialogTarget.close()

    // Submit the form
    if (this.hasFormTarget) {
      this.formTarget.requestSubmit()
    }
  }

  // Called when user cancels
  cancel() {
    this.dialogTarget.close()
  }

  // Close on escape key
  handleKeydown(event) {
    if (event.key === "Escape") {
      this.cancel()
    }
  }

  // Close when clicking backdrop
  backdropClick(event) {
    if (event.target === this.dialogTarget) {
      this.cancel()
    }
  }
}
