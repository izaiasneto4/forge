// Single-key and ⌘↵ shortcuts must not reach the page behind an open dialog, sheet or menu.
export function overlayOpen() {
  return document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null
}
