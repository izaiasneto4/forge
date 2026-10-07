const ACCENT_KEY = 'ordem.accent'
const NOTIFY_KEY = 'ordem.notify'

export const ACCENTS = ['#ff7a3d', '#0a84ff', '#bf5af2', '#ff375f', '#30d158', '#ffd60a', '#98989d']
export const DEFAULT_ACCENT = ACCENTS[0]

function read(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable (private mode); preferences then last for the session only.
  }
}

export function storedAccent() {
  const value = read(ACCENT_KEY) ?? read('forge.accent')
  return value && ACCENTS.includes(value) ? value : DEFAULT_ACCENT
}

// WCAG relative luminance of a #rrggbb color.
function luminance(hex: string) {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function contrastRatio(foreground: string, background: string) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left)
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)
}

export const LIGHT_ON_ACCENT = '#ffffff'
export const DARK_ON_ACCENT = '#141416'

// Text on accent-filled buttons: white when it reaches WCAG AA (4.5:1), otherwise near-black.
export function onAccentColor(accent: string) {
  return contrastRatio(LIGHT_ON_ACCENT, accent) >= 4.5 ? LIGHT_ON_ACCENT : DARK_ON_ACCENT
}

export function applyAccent(accent: string) {
  document.documentElement.style.setProperty('--accent', accent)
  document.documentElement.style.setProperty('--on-accent', onAccentColor(accent))
}

export function saveAccent(accent: string) {
  write(ACCENT_KEY, accent)
  applyAccent(accent)
}

export function desktopNotificationsEnabled() {
  return (read(NOTIFY_KEY) ?? read('forge.notify')) === 'on' && typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

export async function setDesktopNotifications(enabled: boolean) {
  if (!enabled) {
    write(NOTIFY_KEY, 'off')
    return false
  }

  if (typeof Notification === 'undefined') return false
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  const granted = permission === 'granted'
  write(NOTIFY_KEY, granted ? 'on' : 'off')
  return granted
}
