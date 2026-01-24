import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["modal", "form", "cliClient", "reviewType", "cliClientIcon", "prId", "prTitle"]

  static icons = {
    claude: `<svg viewBox="0 0 100 100" fill="#D97757"><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(0 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(30 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(60 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(90 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(120 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(150 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(180 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(210 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(240 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(270 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(300 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(330 50 50)"/><circle cx="50" cy="50" r="12"/></svg>`,
    codex: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`,
    opencode: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h7v14H3V5zm2 2v10h3V7H5zm11-2h5v2h-5v4h3v2h-3v4h5v2h-7V5h2z"/></svg>`
  }

  open(event) {
    event.preventDefault()
    event.stopPropagation()

    const prId = event.currentTarget.dataset.prId
    const prTitle = event.currentTarget.dataset.prTitle
    const prNumber = event.currentTarget.dataset.prNumber

    this.prIdTarget.value = prId
    this.prTitleTarget.textContent = `#${prNumber}: ${prTitle}`

    this.modalTarget.classList.remove("hidden")
    document.body.style.overflow = "hidden"
  }

  close(event) {
    if (event) {
      event.preventDefault()
    }
    this.modalTarget.classList.add("hidden")
    document.body.style.overflow = ""
  }

  closeOnBackdrop(event) {
    if (event.target === this.modalTarget) {
      this.close()
    }
  }

  closeOnEscape(event) {
    if (event.key === "Escape" && !this.modalTarget.classList.contains("hidden")) {
      this.close()
    }
  }

  updateIcon(event) {
    const client = event.target.value.toLowerCase()
    if (this.hasCliClientIconTarget && this.constructor.icons[client]) {
      this.cliClientIconTarget.innerHTML = this.constructor.icons[client].replace("<svg ", `<svg class="w-5 h-5" `)
    }
  }

  submit(event) {
    event.preventDefault()

    const formData = new FormData()
    formData.append("pull_request_id", this.prIdTarget.value)
    formData.append("cli_client", this.cliClientTarget.value)
    formData.append("review_type", this.reviewTypeTarget.value)

    fetch("/review_tasks", {
      method: "POST",
      headers: {
        "X-CSRF-Token": document.querySelector("[name='csrf-token']").content,
        "Accept": "text/vnd.turbo-stream.html"
      },
      body: formData
    }).then(async response => {
      if (response.ok) {
        this.close()
        return response.text()
      }
      // Try to extract error message from response
      const text = await response.text()
      let errorMessage = "Failed to start review"
      try {
        // Check if response contains error details
        if (text.includes("error") || text.includes("Error")) {
          const match = text.match(/(?:error|Error)[:\s]+([^<\n]+)/i)
          if (match) errorMessage = match[1].trim()
        }
      } catch (e) {
        // Ignore parse errors
      }
      throw new Error(errorMessage)
    }).then(html => {
      if (html) Turbo.renderStreamMessage(html)
    }).catch(error => {
      console.error("Review start error:", error)
      const message = error.message || "Unknown error occurred"
      alert(`Failed to start review: ${message}\n\nPlease check your connection and try again.`)
    })
  }

  connect() {
    document.addEventListener("keydown", this.closeOnEscape.bind(this))
  }

  disconnect() {
    document.removeEventListener("keydown", this.closeOnEscape.bind(this))
    document.body.style.overflow = ""
  }
}
