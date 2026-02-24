import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["dropdown", "button", "loading", "repoList", "currentRepoName"]
  static values = {
    open: { type: Boolean, default: false }
  }

  connect() {
    this.boundCloseOnClickOutside = this.closeOnClickOutside.bind(this)
    document.addEventListener("click", this.boundCloseOnClickOutside)
  }

  disconnect() {
    document.removeEventListener("click", this.boundCloseOnClickOutside)
  }

  toggle(event) {
    event.stopPropagation()
    this.openValue = !this.openValue
    this.updateDropdownVisibility()
  }

  closeOnClickOutside(event) {
    if (!this.element.contains(event.target) && this.openValue) {
      this.openValue = false
      this.updateDropdownVisibility()
    }
  }

  updateDropdownVisibility() {
    if (this.hasDropdownTarget) {
      this.dropdownTarget.classList.toggle("hidden", !this.openValue)
    }
  }

  async selectRepo(event) {
    event.preventDefault()
    const repoPath = event.currentTarget.dataset.repoPath
    if (!repoPath || this.switching) return
    this.switching = true

    // Show loading state
    this.showLoading()
    this.openValue = false
    this.updateDropdownVisibility()

    try {
      const response = await fetch("/repositories/switch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": document.querySelector("[name='csrf-token']").content,
          "Accept": "text/vnd.turbo-stream.html"
        },
        body: JSON.stringify({ repo_path: repoPath })
      })

      if (response.ok) {
        const contentType = response.headers.get("content-type")
        if (contentType && contentType.includes("text/vnd.turbo-stream.html")) {
          const html = await response.text()
          Turbo.renderStreamMessage(html)
        }
      } else {
        console.error("Failed to switch repo")
        window.location.reload()
      }
    } catch (error) {
      console.error("Error switching repo:", error)
      window.location.reload()
    } finally {
      this.switching = false
      this.hideLoading()
    }
  }

  showLoading() {
    if (this.hasLoadingTarget) {
      this.loadingTarget.classList.remove("hidden")
    }
  }

  hideLoading() {
    if (this.hasLoadingTarget) {
      this.loadingTarget.classList.add("hidden")
    }
  }
}
