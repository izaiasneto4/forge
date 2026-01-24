import { Controller } from "@hotwired/stimulus"
import { createConsumer } from "@rails/actioncable"

export default class extends Controller {
  static targets = ["log", "container", "status"]
  static values = { reviewTaskId: Number }

  connect() {
    this.consumer = createConsumer()
    this.subscription = this.consumer.subscriptions.create(
      { channel: "ReviewTaskLogsChannel", review_task_id: this.reviewTaskIdValue },
      {
        received: (data) => this.handleMessage(data)
      }
    )
    this.scrollToBottom()
  }

  disconnect() {
    if (this.subscription) {
      this.subscription.unsubscribe()
    }
    if (this.consumer) {
      this.consumer.disconnect()
    }
  }

  handleMessage(data) {
    if (data.type === "completed") {
      window.location.reload()
      return
    }

    this.appendLog(data)
    this.scrollToBottom()
  }

  appendLog(data) {
    const logLine = document.createElement("div")
    logLine.className = this.getLogClass(data.log_type)
    logLine.textContent = data.message
    this.containerTarget.appendChild(logLine)
  }

  getLogClass(logType) {
    const baseClass = "font-mono text-[13px] leading-relaxed py-0.5"
    switch (logType) {
      case "error":
        return `${baseClass} text-red-400`
      case "status":
        return `${baseClass} text-[color:var(--color-accent)] font-medium`
      default:
        return `${baseClass} text-[color:var(--color-text-secondary)]`
    }
  }

  scrollToBottom() {
    if (this.hasContainerTarget) {
      this.containerTarget.scrollTop = this.containerTarget.scrollHeight
    }
  }
}
