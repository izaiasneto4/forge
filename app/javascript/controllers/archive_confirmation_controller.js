import { Controller } from "@hotwired/stimulus"
import * as Turbo from "@hotwired/turbo"

export default class extends Controller {
  static targets = ["modal", "form", "itemType", "itemTypeLabel", "methodInput"]

  open(event) {
    const button = event.currentTarget
    const url = button.dataset.archiveUrl
    const itemType = button.dataset.archiveItemType || "item"
    const itemTypeLabel = button.dataset.archiveItemTypeLabel || itemType

    this.methodInputTarget.value = "patch"
    this.itemTypeTarget.textContent = itemType
    this.itemTypeLabelTarget.textContent = itemTypeLabel
    this.formTarget.action = url

    this.modalTarget.classList.remove("hidden")
  }

  close() {
    this.modalTarget.classList.add("hidden")
  }

  stopPropagation(event) {
    event.stopPropagation()
  }
}
