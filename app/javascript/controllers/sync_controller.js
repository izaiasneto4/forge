import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["button", "modal", "buttonText", "spinner", "forceButton"]
  static values = {
    syncing: { type: Boolean, default: false },
    url: { type: String, default: "/pull_requests/sync" }
  }

  connect() {
    this.autoSync()
  }

  async autoSync() {
    if (this.syncingValue) return

    this.syncingValue = true
    this.disableButton()

    try {
      const response = await fetch(this.urlValue, {
        method: "POST",
        headers: {
          "Accept": "text/vnd.turbo-stream.html",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content
        }
      })

      if (response.ok) {
        const html = await response.text()
        Turbo.renderStreamMessage(html)
      }
    } catch (error) {
      console.error("Auto-sync failed:", error)
    } finally {
      this.reset()
    }
  }

  async forceSync(event) {
    event.preventDefault()

    if (this.syncingValue) return

    this.syncingValue = true
    this.showModal()
    this.disableButton()

    try {
      const response = await fetch(`${this.urlValue}?force=true`, {
        method: "POST",
        headers: {
          "Accept": "text/vnd.turbo-stream.html",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content
        }
      })

      if (response.ok) {
        const html = await response.text()
        Turbo.renderStreamMessage(html)
      }
    } catch (error) {
      console.error("Force sync failed:", error)
    } finally {
      this.reset()
    }
  }

  sync(event) {
    if (this.syncingValue) {
      event.preventDefault()
      return
    }

    this.syncingValue = true
    this.showModal()
    this.disableButton()
  }

  showModal() {
    if (this.hasModalTarget) {
      this.modalTarget.classList.remove("hidden")
    }
  }

  hideModal() {
    if (this.hasModalTarget) {
      this.modalTarget.classList.add("hidden")
    }
  }

  disableButton() {
    if (this.hasButtonTarget) {
      this.buttonTarget.classList.add("opacity-50", "cursor-not-allowed", "pointer-events-none")
    }
    if (this.hasButtonTextTarget) {
      this.buttonTextTarget.textContent = "Syncing..."
    }
    if (this.hasSpinnerTarget) {
      this.spinnerTarget.classList.add("animate-spin")
    }
    if (this.hasForceButtonTarget) {
      this.forceButtonTarget.classList.add("opacity-50", "cursor-not-allowed", "pointer-events-none")
    }
  }

  enableButton() {
    if (this.hasButtonTarget) {
      this.buttonTarget.classList.remove("opacity-50", "cursor-not-allowed", "pointer-events-none")
    }
    if (this.hasButtonTextTarget) {
      this.buttonTextTarget.textContent = "Sync"
    }
    if (this.hasSpinnerTarget) {
      this.spinnerTarget.classList.remove("animate-spin")
    }
    if (this.hasForceButtonTarget) {
      this.forceButtonTarget.classList.remove("opacity-50", "cursor-not-allowed", "pointer-events-none")
    }
  }

  reset() {
    this.syncingValue = false
    this.hideModal()
    this.enableButton()
  }
}
