import { describe, it, expect, beforeEach, vi } from "vitest"
import { Application } from "@hotwired/stimulus"
import BoardFilterController from "../../../app/javascript/controllers/board_filter_controller.js"

describe("BoardFilterController", () => {
  let application
  let controller

  beforeEach(() => {
    localStorage.clear()
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))

    application = Application.start()
    application.register("board-filter", BoardFilterController)

    document.body.innerHTML = `
      <div data-controller="board-filter" data-board-filter-current-user-value="me">
        <input data-board-filter-target="searchInput" value="">
        <input type="checkbox" data-board-filter-target="selfPrToggle" data-action="change->board-filter#toggleOwnPrs" checked>
        <span id="pr_count_pending_review">1</span>
        <span id="pr_count_waiting_implementation">1</span>
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
          <div data-board-filter-target="card" data-current-state="pending_review" data-author="me">
            Pending PR
          </div>
        </div>

        <div data-board-filter-target="column" data-state="waiting_implementation">
          <div data-board-filter-target="card" data-current-state="waiting_implementation" data-author="other">
            Waiting PR
          </div>
        </div>
      </div>
    `

    const element = document.querySelector('[data-controller="board-filter"]')
    controller = application.getControllerForElementAndIdentifier(element, "board-filter")
  })

  it("filters cards by waiting_implementation state on phone", () => {
    const waitingButton = controller.stateFilterTargets.find((btn) => btn.dataset.state === "waiting_implementation")
    waitingButton.click()

    const pendingCard = controller.cardTargets.find((card) => card.dataset.currentState === "pending_review")
    const waitingCard = controller.cardTargets.find((card) => card.dataset.currentState === "waiting_implementation")

    expect(pendingCard.classList.contains("hidden")).toBe(true)
    expect(waitingCard.classList.contains("hidden")).toBe(false)
  })

  it("does not hide cards by state on non-phone viewport", () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 767px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))

    const waitingButton = controller.stateFilterTargets.find((btn) => btn.dataset.state === "waiting_implementation")
    waitingButton.click()

    const pendingCard = controller.cardTargets.find((card) => card.dataset.currentState === "pending_review")
    const waitingCard = controller.cardTargets.find((card) => card.dataset.currentState === "waiting_implementation")

    expect(pendingCard.classList.contains("hidden")).toBe(false)
    expect(waitingCard.classList.contains("hidden")).toBe(false)
  })

  it("hides own PRs when show-my-prs is unchecked", () => {
    const ownToggle = controller.selfPrToggleTarget
    ownToggle.checked = false
    ownToggle.dispatchEvent(new Event("change"))

    const pendingCard = controller.cardTargets.find((card) => card.dataset.author === "me")
    const waitingCard = controller.cardTargets.find((card) => card.dataset.author === "other")

    expect(pendingCard.classList.contains("hidden")).toBe(true)
    expect(waitingCard.classList.contains("hidden")).toBe(false)
  })

  it("updates column count badges to match visible cards", () => {
    controller.searchInputTarget.value = "waiting"
    controller.search()

    expect(document.getElementById("pr_count_pending_review").textContent).toBe("0")
    expect(document.getElementById("pr_count_waiting_implementation").textContent).toBe("1")
  })
})
