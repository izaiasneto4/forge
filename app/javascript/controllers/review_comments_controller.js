import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["comment", "submitButton", "eventSelect"]
  static values = {
    reviewTaskId: Number,
    submitUrl: String
  }

  toggle(event) {
    // Turbo Streams will handle the update automatically
    // This is just for any additional client-side logic if needed
  }

  async submit(event) {
    event.preventDefault()

    const submitButton = this.hasSubmitButtonTarget ? this.submitButtonTarget : event.currentTarget
    const originalText = submitButton.textContent
    submitButton.disabled = true
    submitButton.textContent = "Submitting..."

    try {
      const formData = new FormData()

      if (this.hasEventSelectTarget) {
        formData.append("event", this.eventSelectTarget.value)
      }

      const response = await fetch(this.submitUrlValue, {
        method: "POST",
        headers: {
          "X-CSRF-Token": document.querySelector("[name='csrf-token']").content,
          "Accept": "text/vnd.turbo-stream.html"
        },
        body: formData
      })

      if (response.ok) {
        const html = await response.text()
        Turbo.renderStreamMessage(html)
      } else {
        throw new Error("Failed to submit review")
      }
    } catch (error) {
      console.error("Error submitting review:", error)
      alert("Failed to submit review. Please try again.")
    } finally {
      submitButton.disabled = false
      submitButton.textContent = originalText
    }
  }
}
