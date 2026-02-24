import { describe, it, expect, beforeEach, vi } from "vitest"
import { Application } from "@hotwired/stimulus"
import ReviewKanbanController from "../../../app/javascript/controllers/review_kanban_controller.js"

describe("ReviewKanbanController", () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register("review-kanban", ReviewKanbanController)
    document.body.innerHTML = `
      <div data-controller="review-kanban">
        <div data-review-kanban-target="column" data-state="pending_review">
          <div data-task-id="1" data-current-state="pending_review" class="kanban-card">
            <h3>Task 1</h3>
          </div>
        </div>
        <div data-review-kanban-target="column" data-state="in_review"></div>
        <div data-review-kanban-target="column" data-state="reviewed"></div>
        <div data-review-kanban-target="confirmModal" class="hidden"></div>
        <div data-review-kanban-target="confirmModalContent"></div>
      </div>
    `
    const element = document.querySelector('[data-controller="review-kanban"]')
    controller = application.getControllerForElementAndIdentifier(element, "review-kanban")
  })

  it("connects and initializes", () => {
    expect(controller).toBeDefined()
    expect(controller.columnTargets.length).toBe(3)
    expect(controller.draggedCard).toBe(null)
  })

  it("creates announcer element", () => {
    const announcer = document.getElementById("kanban-announcer")
    expect(announcer).toBeDefined()
    expect(announcer.getAttribute("aria-live")).toBe("assertive")
  })

  it("announces messages", async () => {
    controller.announce("Test message")
    await new Promise((resolve) => setTimeout(resolve, 60))

    const announcer = document.getElementById("kanban-announcer")
    expect(announcer.textContent).toBe("Test message")
  })

  it("handles drag start and drag end", () => {
    const card = document.querySelector('[data-task-id="1"]')

    controller.dragStart({
      target: card,
      dataTransfer: { effectAllowed: "", setData: vi.fn() }
    })
    expect(controller.draggedCard).toBe(card)
    expect(card.classList.contains("kanban-card--dragging")).toBe(true)

    controller.dragEnd({ target: card })
    expect(card.classList.contains("kanban-card--dragging")).toBe(false)
  })

  it("handles drag enter and leave", () => {
    const column = controller.columnTargets[0]
    controller.dragEnter({ preventDefault: vi.fn(), currentTarget: column })
    expect(column.classList.contains("kanban-dropzone--active")).toBe(true)

    controller.dragLeave({ currentTarget: column, relatedTarget: document.body })
    expect(column.classList.contains("kanban-dropzone--active")).toBe(false)
  })

  it("handles drop and updates state", () => {
    const card = document.querySelector('[data-task-id="1"]')
    controller.draggedCard = card
    controller.updateState = vi.fn()

    controller.drop({
      preventDefault: vi.fn(),
      currentTarget: controller.columnTargets[1],
      dataTransfer: { getData: () => "1" }
    })

    expect(controller.updateState).toHaveBeenCalledWith("1", "in_review")
  })

  it("detects backward movement", () => {
    expect(controller.isBackwardMovement("reviewed", "pending_review")).toBe(true)
    expect(controller.isBackwardMovement("pending_review", "reviewed")).toBe(false)
  })

  it("moves to adjacent column with keyboard", () => {
    const card = document.querySelector('[data-task-id="1"]')
    controller.keyboardMovingCard = card

    controller.handleKeydown({ key: "ArrowRight", preventDefault: vi.fn(), target: card })

    const currentColumn = card.closest('[data-review-kanban-target="column"]')
    expect(currentColumn.dataset.state).toBe("in_review")
  })

  it("shows backward confirmation", () => {
    controller.showBackwardConfirmation("reviewed", "pending_review")

    expect(controller.confirmModalTarget.classList.contains("hidden")).toBe(false)
    expect(controller.confirmModalContentTarget.innerHTML).toContain("Move Back in Workflow")
  })

  it("cancels backward move", () => {
    const card = document.querySelector('[data-task-id="1"]')
    controller.pendingMove = {
      card,
      originalPosition: {
        parent: controller.columnTargets[0],
        nextSibling: null,
        state: "pending_review"
      }
    }

    controller.cancelBackwardMove()
    expect(controller.confirmModalTarget.classList.contains("hidden")).toBe(true)
  })

  it("rolls back move on error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"))
    const card = document.querySelector('[data-task-id="1"]')
    controller.originalPosition = {
      parent: controller.columnTargets[0],
      nextSibling: null,
      state: "pending_review"
    }

    await controller.updateState("1", "in_review")
    expect(card.closest('[data-review-kanban-target="column"]').dataset.state).toBe("pending_review")
  })

  it("disconnects and cleans up", () => {
    controller.disconnect()
    expect(document.getElementById("kanban-announcer")).toBe(null)
  })
})
