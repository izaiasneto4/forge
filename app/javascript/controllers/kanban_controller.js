import { Controller } from "@hotwired/stimulus"
import * as Turbo from "@hotwired/turbo"

export default class extends Controller {
  static targets = ["column", "card"]

  connect() {
    this.columnTargets.forEach(column => {
      column.addEventListener("dragover", this.dragOver.bind(this))
      column.addEventListener("drop", this.drop.bind(this))
      column.addEventListener("dragenter", this.dragEnter.bind(this))
      column.addEventListener("dragleave", this.dragLeave.bind(this))
    })
  }

  dragStart(event) {
    this.draggedCard = event.target
    event.target.classList.add("opacity-50")
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", event.target.dataset.prId)
  }

  dragEnd(event) {
    event.target.classList.remove("opacity-50")
    this.columnTargets.forEach(column => {
      column.classList.remove("kanban-column--active")
    })
  }

  dragOver(event) {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }

  dragEnter(event) {
    event.preventDefault()
    const column = event.currentTarget
    column.classList.add("kanban-column--active")
  }

  dragLeave(event) {
    const column = event.currentTarget
    if (!column.contains(event.relatedTarget)) {
      column.classList.remove("kanban-column--active")
    }
  }

  drop(event) {
    event.preventDefault()
    const column = event.currentTarget
    column.classList.remove("kanban-column--active")

    const prId = event.dataTransfer.getData("text/plain")
    const newStatus = column.dataset.status

    if (this.draggedCard) {
      // Move card visually
      column.appendChild(this.draggedCard)

      // Update on server
      this.updateStatus(prId, newStatus)
    }
  }

  async updateStatus(prId, newStatus) {
    try {
      const response = await fetch(`/pull_requests/${prId}/update_status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/vnd.turbo-stream.html",
          "X-CSRF-Token": document.querySelector("[name='csrf-token']").content
        },
        body: JSON.stringify({ review_status: newStatus })
      })

      if (response.ok) {
        const html = await response.text()
        Turbo.renderStreamMessage(html)
      } else {
        console.error("Failed to update status")
        window.location.reload()
      }
    } catch (error) {
      console.error("Error updating status:", error)
      window.location.reload()
    }
  }

  markAsReviewed(event) {
    const prId = event.currentTarget.dataset.prId
    const card = document.getElementById(`pull_request_card_${prId}`)
    const currentColumn = card?.closest("[data-kanban-target='column']")
    const reviewedColumn = document.querySelector("[data-kanban-target='column'][data-status='reviewed_by_me']")

    if (card && reviewedColumn && currentColumn?.dataset.status === "pending_review") {
      reviewedColumn.appendChild(card)
      this.updateStatus(prId, "reviewed_by_me")
      this.updateColumnCounts()
    }
  }

  updateColumnCounts() {
    this.columnTargets.forEach(column => {
      const count = column.querySelectorAll("[data-kanban-target='card']").length
      const columnWrapper = column.closest(".linear-column") || column.closest(".bg-white")
      const badge = columnWrapper?.querySelector(".text-xs.px-2.py-1.rounded-full")
      if (badge) {
        badge.textContent = count
      }
    })
  }
}
