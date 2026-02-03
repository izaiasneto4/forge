import { Controller } from "@hotwired/stimulus"
import { createConsumer } from "@rails/actioncable"

// Global notification controller for showing toast messages
// Subscribes to review_notifications channel for real-time updates
export default class extends Controller {
  static values = {
    channel: { type: String, default: "review_notifications" }
  }

  connect() {
    this.consumer = createConsumer()
    this.subscription = this.consumer.subscriptions.create(
      { channel: "ReviewNotificationsChannel" },
      {
        received: (data) => this.handleNotification(data)
      }
    )
  }

  disconnect() {
    if (this.subscription) {
      this.subscription.unsubscribe()
    }
  }

  handleNotification(data) {
    if (data.type === "review_completed") {
      this.showToast(`Review completed for PR #${data.pr_number}`, "success")
    } else if (data.type === "review_failed") {
      this.showToast(`Review failed for PR #${data.pr_number}: ${data.reason}`, "error")
    }
  }

  showToast(message, type = "info") {
    // Remove existing toast
    const existing = document.querySelector(".global-toast")
    if (existing) existing.remove()

    const toast = document.createElement("div")
    toast.className = `global-toast global-toast--${type}`

    const iconPath = type === "error"
      ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />'
      : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />'

    toast.innerHTML = `
      <div class="flex items-center gap-2">
        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          ${iconPath}
        </svg>
        <span class="flex-1">${message}</span>
        <button type="button" class="flex-shrink-0 hover:opacity-70" onclick="this.parentElement.parentElement.remove()">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    `
    document.body.appendChild(toast)

    // Trigger entrance animation
    requestAnimationFrame(() => toast.classList.add("global-toast--show"))

    // Auto-remove after 5 seconds
    setTimeout(() => {
      toast.classList.remove("global-toast--show")
      setTimeout(() => toast.remove(), 300)
    }, 5000)
  }
}
