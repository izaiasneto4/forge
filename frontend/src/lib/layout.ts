import { useEffect, useState } from 'react'

// Below this width the list and the detail take turns filling the window.
const SINGLE_PANE_QUERY = '(max-width: 640px)'
const FLOATING_SIDEBAR_QUERY = '(max-width: 900px)'
const FLOATING_INSPECTOR_QUERY = '(max-width: 1100px)'

export function singlePane() {
  return window.matchMedia(SINGLE_PANE_QUERY).matches
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])

  return matches
}

export function useFloatingSidebar() {
  return useMediaQuery(FLOATING_SIDEBAR_QUERY)
}

export function useFloatingInspector() {
  return useMediaQuery(FLOATING_INSPECTOR_QUERY)
}
