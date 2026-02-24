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
    this.handleResize = this.handleResize.bind(this)
    window.addEventListener("resize", this.handleResize)
    this.loadSavedFilter()
    this.applyFilters()
  }

  disconnect() {
    window.removeEventListener("resize", this.handleResize)
  }

  handleResize() {
    this.applyFilters()
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

    if (!this.isPhoneViewport()) {
      this.focusColumn(event.currentTarget.dataset.state)
    }

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

    const stateFilter = this.resolvedStateFilter()
    const effectiveStateFilter = this.isPhoneViewport() ? stateFilter : "all"
    const includeOwnPrs = !this.hasSelfPrToggleTarget || this.selfPrToggleTarget.checked
    const currentUser = this.currentUserValue.toLowerCase()

    const visibleCounts = {}

    this.columnTargets.forEach(column => {
      const state = this.columnState(column)
      if (state) visibleCounts[state] = 0
    })

    this.cardTargets.forEach(card => {
      const cardState = card.dataset.currentState
      const cardText = card.textContent.toLowerCase()
      const cardAuthor = (card.dataset.author || "").toLowerCase()

      const matchesSearch = searchTerm === "" || cardText.includes(searchTerm)
      const matchesState = effectiveStateFilter === "all" || cardState === effectiveStateFilter
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
      const state = this.columnState(column)
      if (!state) return

      const emptyState = document.getElementById(`review_task_empty_${state}`)
      if (emptyState) {
        const count = visibleCounts[state] || 0
        emptyState.classList.toggle("hidden", count > 0)
      }

      const countBadge = document.getElementById(`pr_count_${state}`)
      if (countBadge) {
        countBadge.textContent = String(visibleCounts[state] || 0)
      }

      const reviewTaskCountBadge = document.getElementById(`review_task_count_${state}`)
      if (reviewTaskCountBadge) {
        reviewTaskCountBadge.textContent = String(visibleCounts[state] || 0)
      }

      const shouldShowColumn = !this.isPhoneViewport() || stateFilter === "all" || state === stateFilter
      const columnWrapper = column.parentElement || column
      columnWrapper.classList.toggle("hidden", !shouldShowColumn)
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

  columnState(column) {
    return column.dataset.state || column.dataset.status || ""
  }

  activeStateFilter() {
    const activeStateBtn = this.stateFilterTargets.find(btn =>
      btn.classList.contains("linear-btn-primary")
    )
    return activeStateBtn?.dataset.state || "all"
  }

  setActiveStateFilter(state) {
    this.stateFilterTargets.forEach(btn => {
      if (btn.dataset.state === state) {
        btn.classList.remove("linear-btn-ghost")
        btn.classList.add("linear-btn-primary")
      } else {
        btn.classList.remove("linear-btn-primary")
        btn.classList.add("linear-btn-ghost")
      }
    })
  }

  resolvedStateFilter() {
    const state = this.activeStateFilter()
    if (!this.isPhoneViewport() || state !== "all") return state

    const fallbackState =
      this.stateFilterTargets.find(btn => btn.dataset.state === "pending_review")?.dataset.state ||
      this.stateFilterTargets.find(btn => btn.dataset.state !== "all")?.dataset.state ||
      "all"

    this.setActiveStateFilter(fallbackState)
    return fallbackState
  }

  isPhoneViewport() {
    if (typeof window.matchMedia !== "function") return false
    return window.matchMedia("(max-width: 767px)").matches
  }

  focusColumn(state) {
    if (!state || state === "all") return
    const column = this.columnTargets.find((target) => this.columnState(target) === state)
    if (!column) return

    const columnWrapper = column.parentElement || column
    columnWrapper.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "start"
    })
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
