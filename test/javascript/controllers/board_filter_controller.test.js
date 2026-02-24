import { describe, it, expect, beforeEach } from "vitest"
import { Application } from "@hotwired/stimulus"
import BoardFilterController from "../../../app/javascript/controllers/board_filter_controller.js"

describe("BoardFilterController", () => {
  let application
  let controller

  beforeEach(() => {
    localStorage.clear()

    application = Application.start()
    application.register("board-filter", BoardFilterController)

    document.body.innerHTML = `
      <div data-controller="board-filter">
        <input data-board-filter-target="searchInput" value="">
        <button
          class="linear-btn-primary"
          data-board-filter-target="stateFilter"
          data-state="all"
          data-action="click->board-filter#filterState">
          All
        </button>
        <button
          class="linear-btn-ghost"
          data-board-filter-target="stateFilter"
          data-state="waiting_implementation"
          data-action="click->board-filter#filterState">
          Waiting
        </button>

        <div data-board-filter-target="column" data-state="pending_review">
          <div data-board-filter-target="card" data-current-state="pending_review">
            Pending PR
          </div>
        </div>

        <div data-board-filter-target="column" data-state="waiting_implementation">
          <div data-board-filter-target="card" data-current-state="waiting_implementation">
            Waiting PR
          </div>
        </div>
      </div>
    `

    const element = document.querySelector('[data-controller="board-filter"]')
    controller = application.getControllerForElementAndIdentifier(element, "board-filter")
  })

  it("filters cards by waiting_implementation state", () => {
    const waitingButton = controller.stateFilterTargets.find((btn) => btn.dataset.state === "waiting_implementation")
    waitingButton.click()

    const pendingCard = controller.cardTargets.find((card) => card.dataset.currentState === "pending_review")
    const waitingCard = controller.cardTargets.find((card) => card.dataset.currentState === "waiting_implementation")

    expect(pendingCard.classList.contains("hidden")).toBe(true)
    expect(waitingCard.classList.contains("hidden")).toBe(false)
  })
})
