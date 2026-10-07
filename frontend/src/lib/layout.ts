// Below this width the list and the detail take turns filling the window.
const SINGLE_PANE_QUERY = '(max-width: 640px)'

export function singlePane() {
  return window.matchMedia(SINGLE_PANE_QUERY).matches
}
