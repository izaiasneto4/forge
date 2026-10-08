import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Window bounds persisted in <state dir>/desktop-settings.json, clamped back onto
// a visible display when monitors change between launches.

export interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopSettings {
  bounds: Rectangle | null
  maximized: boolean
}

export const DEFAULT_SIZE = Object.freeze({ width: 1280, height: 820 })
export const MIN_SIZE = Object.freeze({ width: 720, height: 480 })
// How much of the window must stay on a display to count as visible.
const MIN_VISIBLE = 64

const EMPTY_SETTINGS: DesktopSettings = Object.freeze({ bounds: null, maximized: false })

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isRectangle(value: unknown): value is Rectangle {
  if (typeof value !== 'object' || value === null) return false
  return (
    'x' in value && isFiniteNumber(value.x) &&
    'y' in value && isFiniteNumber(value.y) &&
    'width' in value && isFiniteNumber(value.width) &&
    'height' in value && isFiniteNumber(value.height)
  )
}

export function parseDesktopSettings(text: string): DesktopSettings {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return EMPTY_SETTINGS
  }
  if (typeof value !== 'object' || value === null) return EMPTY_SETTINGS
  return {
    bounds: 'bounds' in value && isRectangle(value.bounds) ? value.bounds : null,
    maximized: 'maximized' in value && value.maximized === true,
  }
}

export function readDesktopSettings(path: string): DesktopSettings {
  try {
    return parseDesktopSettings(readFileSync(path, 'utf8'))
  } catch {
    return EMPTY_SETTINGS
  }
}

// Write then rename, so a crash mid-write never leaves half a file.
export function writeDesktopSettings(path: string, settings: DesktopSettings) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`)
    renameSync(temporary, path)
  } catch {
    // Losing the window position is not worth an error dialog.
  }
}

function overlap(a: Rectangle, b: Rectangle) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? { width, height } : null
}

function centeredOn(area: Rectangle, size: { width: number; height: number }): Rectangle {
  const width = Math.min(size.width, area.width)
  const height = Math.min(size.height, area.height)
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height }
}

// Saved bounds if enough of the window lands on a display (shrunk to fit it),
// else the default size centred on the primary display.
export function clampToDisplays(saved: Rectangle | null, workAreas: Rectangle[], primary: Rectangle): Rectangle {
  if (saved) {
    const width = Math.max(saved.width, MIN_SIZE.width)
    const height = Math.max(saved.height, MIN_SIZE.height)
    const candidate = { ...saved, width, height }
    for (const area of workAreas) {
      const visible = overlap(candidate, area)
      if (!visible || visible.width < MIN_VISIBLE || visible.height < MIN_VISIBLE) continue
      const fittedWidth = Math.min(width, area.width)
      const fittedHeight = Math.min(height, area.height)
      return {
        x: Math.min(Math.max(candidate.x, area.x), area.x + area.width - fittedWidth),
        y: Math.min(Math.max(candidate.y, area.y), area.y + area.height - fittedHeight),
        width: fittedWidth,
        height: fittedHeight,
      }
    }
  }
  return centeredOn(primary, DEFAULT_SIZE)
}
