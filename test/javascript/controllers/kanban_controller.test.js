import { describe, it, expect, beforeEach, vi } from "vitest"
import { Application } from "@hotwired/stimulus"
import KanbanController from "../../../app/javascript/controllers/kanban_controller.js"

describe("KanbanController", () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register("kanban", KanbanController)
    document.body.innerHTML = `
      <div data-controller="kanban">
        <div class="linear-column">
          <span class="text-xs px-2 py-1 rounded-full">1</span>
          <div data-kanban-target="column" data-status="pending_review">
            <div data-kanban-target="card" draggable="true" data-pr-id="1">PR #1</div>
          </div>
        </div>
        <div class="linear-column">
          <span class="text-xs px-2 py-1 rounded-full">0</span>
          <div data-kanban-target="column" data-status="in_review"></div>
        </div>
        <div class="linear-column">
          <span class="text-xs px-2 py-1 rounded-full">0</span>
          <div data-kanban-target="column" data-status="reviewed_by_me"></div>
        </div>
      </div>
    `
    const element = document.querySelector('[data-controller="kanban"]')
    controller = application.getControllerForElementAndIdentifier(element, "kanban")
  })

  it("connects and initializes drag listeners", () => {
    expect(controller).toBeDefined()
    expect(controller.columnTargets.length).toBe(3)
  })

  it("handles drag start", () => {
    const card = controller.cardTargets[0]
    const event = {
      target: card,
      dataTransfer: { effectAllowed: "", setData: vi.fn() }
    }

    controller.dragStart(event)
    expect(controller.draggedCard).toBe(card)
    expect(card.classList.contains("opacity-50")).toBe(true)
    expect(event.dataTransfer.setData).toHaveBeenCalledWith("text/plain", "1")
  })

  it("handles drag end", () => {
    const card = controller.cardTargets[0]
    const column = controller.columnTargets[0]
    card.classList.add("opacity-50")
    column.classList.add("kanban-column--active")

    controller.dragEnd({ target: card })

    expect(card.classList.contains("opacity-50")).toBe(false)
    expect(column.classList.contains("kanban-column--active")).toBe(false)
  })

  it("handles drag over", () => {
    const event = { preventDefault: vi.fn(), dataTransfer: {} }
    controller.dragOver(event)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it("handles drag enter and leave", () => {
    const column = controller.columnTargets[0]

    controller.dragEnter({ preventDefault: vi.fn(), currentTarget: column })
    expect(column.classList.contains("kanban-column--active")).toBe(true)

    controller.dragLeave({ currentTarget: column, relatedTarget: document.body })
    expect(column.classList.contains("kanban-column--active")).toBe(false)
  })

  it("handles drop and updates status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<turbo-stream>test</turbo-stream>")
    })

    const card = controller.cardTargets[0]
    controller.draggedCard = card

    const targetColumn = controller.columnTargets[1]
    controller.drop({
      preventDefault: vi.fn(),
      currentTarget: targetColumn,
      dataTransfer: { getData: () => "1" }
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(global.fetch).toHaveBeenCalledWith(
      "/pull_requests/1/update_status",
      expect.objectContaining({ method: "PATCH" })
    )
  })

  it("marks as reviewed", () => {
    const card = controller.cardTargets[0]
    card.id = "pull_request_card_1"

    controller.updateStatus = vi.fn()
    controller.markAsReviewed({
      currentTarget: { dataset: { prId: "1" } }
    })

    expect(controller.updateStatus).toHaveBeenCalledWith("1", "reviewed_by_me")
  })

  it("updates column counts", () => {
    controller.updateColumnCounts()
    const badges = [...document.querySelectorAll(".text-xs.px-2.py-1.rounded-full")]
    expect(badges[0].textContent).toBe("1")
  })
})
