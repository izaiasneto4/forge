import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { content: String }

  async copy(event) {
    event.preventDefault()
    const button = event.currentTarget
    const originalText = button.innerHTML

    try {
      await navigator.clipboard.writeText(this.contentValue)
      button.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Copied!`
      button.classList.add("text-green-400")

      setTimeout(() => {
        button.innerHTML = originalText
        button.classList.remove("text-green-400")
      }, 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }
}
