import { Controller } from "@hotwired/stimulus"
import * as Turbo from "@hotwired/turbo"

export default class extends Controller {
  static targets = ["column", "card", "modal", "modalContent", "confirmModal", "confirmModalContent", "announcer"]

  // State order for detecting backward movement (lower index = earlier in workflow)
  static stateOrder = ["pending_review", "in_review", "reviewed", "waiting_implementation", "done"]

  connect() {
    this.columnTargets.forEach(column => {
      column.addEventListener("dragover", this.dragOver.bind(this))
      column.addEventListener("drop", this.drop.bind(this))
      column.addEventListener("dragenter", this.dragEnter.bind(this))
      column.addEventListener("dragleave", this.dragLeave.bind(this))
    })
    this.pendingMove = null
    this.draggedCard = null
    this.keyboardMovingCard = null
    this.dropPreview = null
    this.originalPosition = null

    // Create announcer element for screen readers
    this.createAnnouncer()
  }

  disconnect() {
    this.removeAnnouncer()
    this.removeDropPreview()
  }

  // ============================================
  // Screen Reader Announcements
  // ============================================

  createAnnouncer() {
    if (!document.getElementById("kanban-announcer")) {
      const announcer = document.createElement("div")
      announcer.id = "kanban-announcer"
      announcer.className = "sr-only"
      announcer.setAttribute("aria-live", "assertive")
      announcer.setAttribute("aria-atomic", "true")
      document.body.appendChild(announcer)
    }
  }

  removeAnnouncer() {
    const announcer = document.getElementById("kanban-announcer")
    if (announcer) announcer.remove()
  }

  announce(message) {
    const announcer = document.getElementById("kanban-announcer")
    if (announcer) {
      announcer.textContent = ""
      // Small delay to ensure screen readers pick up the change
      setTimeout(() => { announcer.textContent = message }, 50)
    }
  }

  // ============================================
  // Visual Feedback - Drop Preview & Toast
  // ============================================

  createDropPreview() {
    if (!this.dropPreview) {
      this.dropPreview = document.createElement("div")
      this.dropPreview.className = "kanban-drop-preview"
      this.dropPreview.setAttribute("aria-hidden", "true")
    }
    return this.dropPreview
  }

  removeDropPreview() {
    if (this.dropPreview && this.dropPreview.parentNode) {
      this.dropPreview.parentNode.removeChild(this.dropPreview)
    }
  }

  showToast(message, type = "info") {
    // Remove existing toast
    const existing = document.querySelector(".kanban-toast")
    if (existing) existing.remove()

    const toast = document.createElement("div")
    toast.className = `kanban-toast kanban-toast--${type}`
    toast.innerHTML = `
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        ${type === "error"
          ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />'
          : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />'}
      </svg>
      <span>${message}</span>
    `
    document.body.appendChild(toast)

    // Auto-remove after 3 seconds
    setTimeout(() => toast.remove(), 3000)
  }

  // ============================================
  // Mouse Drag and Drop
  // ============================================

  dragStart(event) {
    this.draggedCard = event.target.closest("[data-task-id]")
    if (this.draggedCard) {
      // Store original position for potential rollback
      this.originalPosition = {
        parent: this.draggedCard.parentNode,
        nextSibling: this.draggedCard.nextElementSibling
      }

      this.draggedCard.classList.add("kanban-card--dragging")
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setData("text/plain", this.draggedCard.dataset.taskId)

      // Announce drag start
      const title = this.draggedCard.querySelector("h3")?.textContent?.trim() || "Card"
      this.announce(`Picked up ${title}. Drop on a column to move.`)
    }
  }

  dragEnd(event) {
    const card = event.target.closest("[data-task-id]")
    if (card) {
      card.classList.remove("kanban-card--dragging")
    }
    this.columnTargets.forEach(column => {
      column.classList.remove("kanban-dropzone--active", "kanban-dropzone--valid")
    })
    this.removeDropPreview()
    this.draggedCard = null
  }

  dragOver(event) {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"

    // Position drop preview
    if (this.draggedCard) {
      const column = event.currentTarget
      const preview = this.createDropPreview()

      // Find insertion point based on mouse position
      const cards = [...column.querySelectorAll(".kanban-card:not(.kanban-card--dragging)")]
      const afterCard = cards.find(card => {
        const rect = card.getBoundingClientRect()
        return event.clientY < rect.top + rect.height / 2
      })

      if (afterCard) {
        column.insertBefore(preview, afterCard)
      } else {
        // Insert before the empty message or at end
        const emptyMsg = column.querySelector("[id^='review_task_empty_']")
        if (emptyMsg) {
          column.insertBefore(preview, emptyMsg)
        } else {
          column.appendChild(preview)
        }
      }
    }
  }

  dragEnter(event) {
    event.preventDefault()
    const column = event.currentTarget
    column.classList.add("kanban-dropzone--active")

    // Check if it's a valid drop target
    if (this.draggedCard) {
      const currentState = this.draggedCard.dataset.currentState
      const newState = column.dataset.state
      if (currentState !== newState) {
        column.classList.add("kanban-dropzone--valid")
      }
    }
  }

  dragLeave(event) {
    const column = event.currentTarget
    if (!column.contains(event.relatedTarget)) {
      column.classList.remove("kanban-dropzone--active", "kanban-dropzone--valid")
      this.removeDropPreview()
    }
  }

  drop(event) {
    event.preventDefault()
    const column = event.currentTarget
    column.classList.remove("kanban-dropzone--active", "kanban-dropzone--valid")
    this.removeDropPreview()

    const taskId = event.dataTransfer.getData("text/plain")
    const newState = column.dataset.state
    const currentState = this.draggedCard?.dataset.currentState

    if (this.draggedCard && currentState !== newState) {
      // Check if this is a backward movement
      if (this.isBackwardMovement(currentState, newState)) {
        this.pendingMove = { taskId, newState, card: this.draggedCard, targetColumn: column }
        this.showBackwardConfirmation(currentState, newState)
      } else {
        // Optimistic UI update
        column.appendChild(this.draggedCard)
        this.draggedCard.dataset.currentState = newState
        this.updateState(taskId, newState)
      }
    }
  }

  // ============================================
  // Keyboard Navigation
  // ============================================

  handleKeydown(event) {
    const card = event.target.closest("[data-task-id]")
    if (!card) return

    switch (event.key) {
      case " ":
      case "Enter":
        event.preventDefault()
        this.toggleKeyboardMove(card)
        break
      case "Escape":
        if (this.keyboardMovingCard) {
          event.preventDefault()
          this.cancelKeyboardMove()
        }
        break
      case "ArrowLeft":
        if (this.keyboardMovingCard) {
          event.preventDefault()
          this.moveToAdjacentColumn(card, -1)
        }
        break
      case "ArrowRight":
        if (this.keyboardMovingCard) {
          event.preventDefault()
          this.moveToAdjacentColumn(card, 1)
        }
        break
      case "ArrowUp":
        event.preventDefault()
        this.focusAdjacentCard(card, -1)
        break
      case "ArrowDown":
        event.preventDefault()
        this.focusAdjacentCard(card, 1)
        break
    }
  }

  toggleKeyboardMove(card) {
    if (this.keyboardMovingCard === card) {
      // Already moving this card - drop it
      this.completeKeyboardMove()
    } else if (this.keyboardMovingCard) {
      // Moving different card - cancel and start new
      this.cancelKeyboardMove()
      this.startKeyboardMove(card)
    } else {
      // Start moving this card
      this.startKeyboardMove(card)
    }
  }

  startKeyboardMove(card) {
    this.keyboardMovingCard = card
    this.originalPosition = {
      parent: card.parentNode,
      nextSibling: card.nextElementSibling,
      state: card.dataset.currentState
    }
    card.classList.add("kanban-card--keyboard-moving")
    card.setAttribute("aria-grabbed", "true")

    const title = card.querySelector("h3")?.textContent?.trim() || "Card"
    this.announce(`${title} grabbed. Use left and right arrow keys to move between columns. Press Space or Enter to drop.`)
  }

  completeKeyboardMove() {
    if (!this.keyboardMovingCard) return

    const card = this.keyboardMovingCard
    const newState = card.dataset.currentState
    const originalState = this.originalPosition?.state
    const taskId = card.dataset.taskId

    card.classList.remove("kanban-card--keyboard-moving")
    card.setAttribute("aria-grabbed", "false")

    if (newState !== originalState) {
      if (this.isBackwardMovement(originalState, newState)) {
        this.pendingMove = {
          taskId,
          newState,
          card,
          targetColumn: card.parentNode,
          originalPosition: this.originalPosition
        }
        this.showBackwardConfirmation(originalState, newState)
      } else {
        this.updateState(taskId, newState)
        const columnLabel = this.formatStateLabel(newState)
        this.announce(`Dropped in ${columnLabel}`)
      }
    } else {
      this.announce("Dropped in same column")
    }

    this.keyboardMovingCard = null
    this.originalPosition = null
  }

  cancelKeyboardMove() {
    if (!this.keyboardMovingCard) return

    const card = this.keyboardMovingCard

    // Restore original position
    if (this.originalPosition) {
      const { parent, nextSibling, state } = this.originalPosition
      if (nextSibling) {
        parent.insertBefore(card, nextSibling)
      } else {
        parent.appendChild(card)
      }
      card.dataset.currentState = state
    }

    card.classList.remove("kanban-card--keyboard-moving")
    card.setAttribute("aria-grabbed", "false")

    this.announce("Movement cancelled")
    this.keyboardMovingCard = null
    this.originalPosition = null
  }

  moveToAdjacentColumn(card, direction) {
    const columns = this.columnTargets
    const currentColumn = card.closest("[data-review-kanban-target='column']")
    const currentIndex = columns.indexOf(currentColumn)
    const newIndex = currentIndex + direction

    if (newIndex >= 0 && newIndex < columns.length) {
      const targetColumn = columns[newIndex]
      const newState = targetColumn.dataset.state

      // Move card to new column
      targetColumn.appendChild(card)
      card.dataset.currentState = newState

      const columnLabel = this.formatStateLabel(newState)
      this.announce(`Moved to ${columnLabel}`)
    }
  }

  focusAdjacentCard(card, direction) {
    const column = card.closest("[data-review-kanban-target='column']")
    const cards = [...column.querySelectorAll(".kanban-card")]
    const currentIndex = cards.indexOf(card)
    const newIndex = currentIndex + direction

    if (newIndex >= 0 && newIndex < cards.length) {
      cards[newIndex].focus()
    }
  }

  // ============================================
  // State Management
  // ============================================

  isBackwardMovement(currentState, newState) {
    if (newState === "failed_review") return false
    const currentIndex = this.constructor.stateOrder.indexOf(currentState)
    const newIndex = this.constructor.stateOrder.indexOf(newState)
    if (currentIndex === -1 || newIndex === -1) return false
    return newIndex < currentIndex
  }

  showBackwardConfirmation(currentState, newState) {
    const fromLabel = this.formatStateLabel(currentState)
    const toLabel = this.formatStateLabel(newState)

    if (this.hasConfirmModalTarget) {
      const content = this.confirmModalContentTarget
      content.innerHTML = `
        <div class="p-6">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900">Move Back in Workflow?</h3>
              <p class="text-sm text-gray-500">This will archive the current review</p>
            </div>
          </div>
          <div class="bg-gray-50 rounded-lg p-4 mb-4">
            <p class="text-sm text-gray-700">
              Moving from <strong>${fromLabel}</strong> back to <strong>${toLabel}</strong> will:
            </p>
            <ul class="mt-2 text-sm text-gray-600 list-disc list-inside space-y-1">
              <li>Archive the current review as a historical iteration</li>
              <li>Clear the current review comments and output</li>
              <li>Allow a new review to be started</li>
            </ul>
            <p class="mt-3 text-sm text-gray-500 italic">
              Previous reviews will be preserved and viewable in the review history.
            </p>
          </div>
          <div class="flex justify-end gap-3">
            <button type="button"
                    class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500"
                    data-action="click->review-kanban#cancelBackwardMove">
              Cancel
            </button>
            <button type="button"
                    class="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500"
                    data-action="click->review-kanban#confirmBackwardMove"
                    autofocus>
              Move & Archive
            </button>
          </div>
        </div>
      `
      this.confirmModalTarget.classList.remove("hidden")

      // Focus the confirm button for keyboard users
      setTimeout(() => {
        const confirmBtn = content.querySelector("[data-action*='confirmBackwardMove']")
        if (confirmBtn) confirmBtn.focus()
      }, 100)

      this.announce("Confirmation dialog opened. Moving backward will archive the current review.")
    }
  }

  formatStateLabel(state) {
    return state.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
  }

  cancelBackwardMove() {
    // Restore card to original position
    if (this.pendingMove?.originalPosition) {
      const { parent, nextSibling, state } = this.pendingMove.originalPosition
      const card = this.pendingMove.card
      if (nextSibling) {
        parent.insertBefore(card, nextSibling)
      } else {
        parent.appendChild(card)
      }
      card.dataset.currentState = state
    } else if (this.pendingMove && this.originalPosition) {
      const card = this.pendingMove.card
      if (this.originalPosition.nextSibling) {
        this.originalPosition.parent.insertBefore(card, this.originalPosition.nextSibling)
      } else {
        this.originalPosition.parent.appendChild(card)
      }
    }

    this.pendingMove = null
    this.originalPosition = null
    if (this.hasConfirmModalTarget) {
      this.confirmModalTarget.classList.add("hidden")
    }
    this.announce("Movement cancelled")
  }

  confirmBackwardMove() {
    if (this.pendingMove) {
      const { taskId, newState, card, targetColumn } = this.pendingMove

      // Ensure card is in target column
      if (card.parentNode !== targetColumn) {
        targetColumn.appendChild(card)
      }
      card.dataset.currentState = newState

      this.updateState(taskId, newState, true)
      this.pendingMove = null
      this.originalPosition = null

      const columnLabel = this.formatStateLabel(newState)
      this.announce(`Moved to ${columnLabel} and archived previous review`)
    }
    if (this.hasConfirmModalTarget) {
      this.confirmModalTarget.classList.add("hidden")
    }
  }

  async updateState(taskId, newState, isBackwardMove = false) {
    const card = document.querySelector(`[data-task-id="${taskId}"]`)

    // Show loading state
    if (card) {
      card.classList.add("kanban-card--loading")
    }

    try {
      const response = await fetch(`/review_tasks/${taskId}/update_state`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/vnd.turbo-stream.html",
          "X-CSRF-Token": document.querySelector("[name='csrf-token']").content
        },
        body: JSON.stringify({ state: newState, backward_move: isBackwardMove })
      })

      if (response.ok) {
        const html = await response.text()
        Turbo.renderStreamMessage(html)

        // Remove loading state
        if (card) {
          card.classList.remove("kanban-card--loading")
        }
      } else {
        // Rollback on failure
        this.rollbackMove(card, taskId)
        this.showToast("Failed to update state. Please try again.", "error")
        this.announce("Failed to update state")
      }
    } catch (error) {
      console.error("Error updating state:", error)
      // Rollback on error
      this.rollbackMove(card, taskId)
      this.showToast("Network error. Please try again.", "error")
      this.announce("Network error occurred")
    }
  }

  rollbackMove(card, taskId) {
    if (card) {
      card.classList.remove("kanban-card--loading")
    }

    if (this.originalPosition) {
      const cardToMove = card || document.querySelector(`[data-task-id="${taskId}"]`)
      if (cardToMove && this.originalPosition.parent) {
        if (this.originalPosition.nextSibling) {
          this.originalPosition.parent.insertBefore(cardToMove, this.originalPosition.nextSibling)
        } else {
          this.originalPosition.parent.appendChild(cardToMove)
        }
        if (this.originalPosition.state) {
          cardToMove.dataset.currentState = this.originalPosition.state
        }
      }
    }

    this.originalPosition = null
  }

  // ============================================
  // Review Modal
  // ============================================

  showReview(event) {
    // Don't navigate if keyboard moving
    if (this.keyboardMovingCard) return

    event.preventDefault()
    event.stopPropagation()

    const taskId = event.currentTarget.dataset.taskId ||
                   event.currentTarget.closest("[data-task-id]")?.dataset.taskId

    if (taskId) {
      window.location.href = `/review_tasks/${taskId}`
    }
  }

  closeModal() {
    if (this.hasModalTarget) {
      this.modalTarget.classList.add("hidden")
    }
  }
}
