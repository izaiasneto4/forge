import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["toggle", "label", "lightIcon", "darkIcon"]
  static values = { updateUrl: String }

  connect() {
    this.currentTheme = this.resolveInitialTheme()
    this.applyTheme(this.currentTheme)
  }

  toggle(event) {
    event.preventDefault()

    const previousTheme = this.currentTheme
    const nextTheme = this.currentTheme === "dark" ? "light" : "dark"

    this.applyTheme(nextTheme)
    this.persistTheme(nextTheme).catch((error) => {
      console.error("Theme update failed:", error)
      this.applyTheme(previousTheme)
    })
  }

  resolveInitialTheme() {
    const htmlTheme = document.documentElement.dataset.theme
    if (htmlTheme === "light" || htmlTheme === "dark") return htmlTheme

    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  }

  applyTheme(theme) {
    this.currentTheme = theme
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    this.updateThemeColor(theme)
    this.syncToggleUI()
  }

  syncToggleUI() {
    const darkMode = this.currentTheme === "dark"

    this.toggleTargets.forEach((toggle) => {
      toggle.setAttribute("aria-pressed", String(darkMode))
      toggle.setAttribute("aria-label", darkMode ? "Switch to light mode" : "Switch to dark mode")
      toggle.setAttribute("title", darkMode ? "Switch to light mode" : "Switch to dark mode")
    })

    this.labelTargets.forEach((label) => {
      label.textContent = darkMode ? "Dark" : "Light"
    })

    this.lightIconTargets.forEach((icon) => {
      icon.classList.toggle("hidden", darkMode)
    })

    this.darkIconTargets.forEach((icon) => {
      icon.classList.toggle("hidden", !darkMode)
    })
  }

  updateThemeColor(theme) {
    const themeColorMeta = document.querySelector('meta[name="theme-color"]')
    if (themeColorMeta) {
      themeColorMeta.setAttribute("content", theme === "dark" ? "#111827" : "#ffffff")
    }
  }

  async persistTheme(theme) {
    const response = await fetch(this.updateUrlValue, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-CSRF-Token": document.querySelector("[name='csrf-token']")?.content
      },
      body: JSON.stringify({ theme_preference: theme })
    })

    if (!response.ok) {
      throw new Error("Failed to persist theme preference")
    }

    const payload = await response.json()
    if (!["light", "dark"].includes(payload.theme_preference)) {
      throw new Error("Invalid theme response")
    }

    this.applyTheme(payload.theme_preference)
  }
}
