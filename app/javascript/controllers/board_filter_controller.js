import { Controller } from "@hotwired/stimulus"

// Client-side filtering for kanban boards
// Filters cards by text search and state
export default class extends Controller {
  static targets = ["searchInput", "stateFilter", "card", "column", "emptyState", "selfPrToggle"]

  static values = {
    storageKey: { type: String, default: "board_filter" },
    currentUser: { type: String, default: "" }
  }

  connect() {
    this.loadSavedFilter()
  }

  search() {
    this.applyFilters()
    this.saveFilter()
  }

  filterState(event) {
    // Toggle active state on filter buttons
    this.stateFilterTargets.forEach(btn => {
      btn.classList.remove("linear-btn-primary")
      btn.classList.add("linear-btn-ghost")
    })
    event.currentTarget.classList.remove("linear-btn-ghost")
    event.currentTarget.classList.add("linear-btn-primary")

    this.applyFilters()
    this.saveFilter()
  }

  clearFilters() {
    if (this.hasSearchInputTarget) {
      this.searchInputTarget.value = ""
    }
    this.stateFilterTargets.forEach(btn => {
      btn.classList.remove("linear-btn-primary")
      btn.classList.add("linear-btn-ghost")
    })
    // Set "All" as active
    const allBtn = this.stateFilterTargets.find(btn => btn.dataset.state === "all")
    if (allBtn) {
      allBtn.classList.remove("linear-btn-ghost")
      allBtn.classList.add("linear-btn-primary")
    }
    if (this.hasSelfPrToggleTarget) {
      this.selfPrToggleTarget.checked = true
    }

    this.applyFilters()
    this.saveFilter()
  }

  toggleOwnPrs() {
    this.applyFilters()
    this.saveFilter()
  }

  applyFilters() {
    const searchTerm = this.hasSearchInputTarget
      ? this.searchInputTarget.value.toLowerCase().trim()
      : ""

    const activeStateBtn = this.stateFilterTargets.find(btn =>
      btn.classList.contains("linear-btn-primary")
    )
    const stateFilter = activeStateBtn?.dataset.state || "all"
    const includeOwnPrs = !this.hasSelfPrToggleTarget || this.selfPrToggleTarget.checked
    const currentUser = this.currentUserValue.toLowerCase()

    let visibleCounts = {}

    this.cardTargets.forEach(card => {
      const cardState = card.dataset.currentState
      const cardText = card.textContent.toLowerCase()
      const cardAuthor = (card.dataset.author || "").toLowerCase()

      const matchesSearch = searchTerm === "" || cardText.includes(searchTerm)
      const matchesState = stateFilter === "all" || cardState === stateFilter
      const matchesAuthor = includeOwnPrs || currentUser === "" || cardAuthor !== currentUser

      if (matchesSearch && matchesState && matchesAuthor) {
        card.classList.remove("hidden")
        visibleCounts[cardState] = (visibleCounts[cardState] || 0) + 1
      } else {
        card.classList.add("hidden")
      }
    })

    // Update empty states for each column
    this.columnTargets.forEach(column => {
      const state = column.dataset.state
      const emptyState = document.getElementById(`review_task_empty_${state}`)
      if (emptyState) {
        const count = visibleCounts[state] || 0
        emptyState.classList.toggle("hidden", count > 0)
      }
    })
  }

  saveFilter() {
    const filter = {
      search: this.hasSearchInputTarget ? this.searchInputTarget.value : "",
      state: this.stateFilterTargets.find(btn =>
        btn.classList.contains("linear-btn-primary")
      )?.dataset.state || "all",
      includeOwnPrs: !this.hasSelfPrToggleTarget || this.selfPrToggleTarget.checked
    }
    localStorage.setItem(this.storageKeyValue, JSON.stringify(filter))
  }

  loadSavedFilter() {
    try {
      const saved = localStorage.getItem(this.storageKeyValue)
      if (!saved) return

      const filter = JSON.parse(saved)

      if (filter.search && this.hasSearchInputTarget) {
        this.searchInputTarget.value = filter.search
      }

      if (filter.state) {
        this.stateFilterTargets.forEach(btn => {
          if (btn.dataset.state === filter.state) {
            btn.classList.remove("linear-btn-ghost")
            btn.classList.add("linear-btn-primary")
          } else {
            btn.classList.remove("linear-btn-primary")
            btn.classList.add("linear-btn-ghost")
          }
        })
      }
      if (this.hasSelfPrToggleTarget && Object.prototype.hasOwnProperty.call(filter, "includeOwnPrs")) {
        this.selfPrToggleTarget.checked = !!filter.includeOwnPrs
      }

      this.applyFilters()
    } catch (e) {
      // Ignore parse errors
    }
  }
}
