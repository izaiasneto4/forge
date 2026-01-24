import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["input"]
  static values = {
    url: { type: String, default: "/settings/pick_folder" }
  }

  async pick(event) {
    event.preventDefault()

    const button = event.currentTarget
    const originalText = button.textContent
    button.textContent = "Opening..."
    button.disabled = true

    try {
      const response = await fetch(this.urlValue, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content
        }
      })

      if (response.ok) {
        const data = await response.json()
        if (data.path) {
          this.inputTarget.value = data.path
        }
      }
    } catch (error) {
      console.error("Folder picker failed:", error)
    } finally {
      button.textContent = originalText
      button.disabled = false
    }
  }
}
