const ACCENT_KEY = 'forge.accent'
const NOTIFY_KEY = 'forge.notify'

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
  const value = read(ACCENT_KEY)
  return value && ACCENTS.includes(value) ? value : DEFAULT_ACCENT
}

export function applyAccent(accent: string) {
  document.documentElement.style.setProperty('--accent', accent)
}

export function saveAccent(accent: string) {
  write(ACCENT_KEY, accent)
  applyAccent(accent)
}

export function desktopNotificationsEnabled() {
  return read(NOTIFY_KEY) === 'on' && typeof Notification !== 'undefined' && Notification.permission === 'granted'
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
