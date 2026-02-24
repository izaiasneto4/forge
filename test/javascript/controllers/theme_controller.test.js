import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Application } from "@hotwired/stimulus"
import ThemeController from "../../../app/javascript/controllers/theme_controller.js"

describe("ThemeController", () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register("theme", ThemeController)

    document.head.innerHTML = `
      <meta name="csrf-token" content="test-csrf-token">
      <meta name="theme-color" content="#ffffff">
      <meta name="forge-theme-preference" content="">
    `

    document.body.innerHTML = `
      <div data-controller="theme" data-theme-update-url-value="/settings/theme">
        <button type="button" data-theme-target="toggle" data-action="click->theme#toggle">
          <span data-theme-target="lightIcon"></span>
          <span data-theme-target="darkIcon" class="hidden"></span>
          <span data-theme-target="label"></span>
        </button>
        <button type="button" data-theme-target="toggle" data-action="click->theme#toggle">
          <span data-theme-target="lightIcon"></span>
          <span data-theme-target="darkIcon" class="hidden"></span>
          <span data-theme-target="label"></span>
        </button>
      </div>
    `

    const element = document.querySelector('[data-controller="theme"]')
    controller = application.getControllerForElementAndIdentifier(element, "theme")
  })

  afterEach(() => {
    application.stop()
    vi.restoreAllMocks()
    delete global.fetch
    document.documentElement.removeAttribute("data-theme")
    document.documentElement.style.colorScheme = ""
  })

  it("applies theme from html dataset", () => {
    document.documentElement.dataset.theme = "dark"
    controller.connect()

    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")
    expect(controller.labelTargets[0].textContent).toBe("Dark")
  })

  it("toggles theme and persists to server", async () => {
    document.documentElement.dataset.theme = "light"
    controller.connect()

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ theme_preference: "dark" })
    })

    controller.toggleTargets[0].click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(global.fetch).toHaveBeenCalledWith(
      "/settings/theme",
      expect.objectContaining({
        method: "PATCH"
      })
    )
    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(controller.toggleTargets[0].getAttribute("aria-pressed")).toBe("true")
  })

  it("rolls back theme on persistence failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    document.documentElement.dataset.theme = "light"
    controller.connect()

    global.fetch = vi.fn().mockRejectedValue(new Error("network"))

    controller.toggleTargets[0].click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(errorSpy).toHaveBeenCalled()
    expect(document.documentElement.dataset.theme).toBe("light")
    expect(controller.toggleTargets[0].getAttribute("aria-pressed")).toBe("false")
  })

  it("syncs all toggles and labels", async () => {
    document.documentElement.dataset.theme = "light"
    controller.connect()

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ theme_preference: "dark" })
    })

    controller.toggleTargets[1].click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    controller.toggleTargets.forEach((toggle) => {
      expect(toggle.getAttribute("aria-pressed")).toBe("true")
      expect(toggle.getAttribute("aria-label")).toBe("Switch to light mode")
    })
    controller.labelTargets.forEach((label) => {
      expect(label.textContent).toBe("Dark")
    })
  })
})
