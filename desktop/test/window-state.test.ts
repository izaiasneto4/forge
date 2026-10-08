import { describe, expect, test } from 'bun:test'
import { clampToDisplays, DEFAULT_SIZE, MIN_SIZE, parseDesktopSettings } from '../src/window-state'

const primary = { x: 0, y: 25, width: 1512, height: 920 }
const external = { x: 1512, y: 0, width: 2560, height: 1415 }

describe('clampToDisplays', () => {
  test('keeps bounds that sit on a display', () => {
    const saved = { x: 1700, y: 100, width: 1400, height: 900 }

    expect(clampToDisplays(saved, [primary, external], primary)).toEqual(saved)
  })

  test('centres the default size when the saved display is gone', () => {
    const onUnpluggedMonitor = { x: 5000, y: 100, width: 1400, height: 900 }

    const bounds = clampToDisplays(onUnpluggedMonitor, [primary], primary)

    expect(bounds.width).toBe(DEFAULT_SIZE.width)
    expect(bounds.x).toBe(primary.x + (primary.width - DEFAULT_SIZE.width) / 2)
  })

  test('shrinks and pulls a window that hangs off its display back inside', () => {
    const hangingOff = { x: 1000, y: 25, width: 2000, height: 600 }

    const bounds = clampToDisplays(hangingOff, [primary], primary)

    expect(bounds).toEqual({ x: primary.x, y: hangingOff.y, width: primary.width, height: hangingOff.height })
  })

  test('raises tiny saved sizes to the minimum', () => {
    const tiny = { x: 100, y: 100, width: 200, height: 100 }

    const bounds = clampToDisplays(tiny, [primary], primary)

    expect(bounds.width).toBe(MIN_SIZE.width)
    expect(bounds.height).toBe(MIN_SIZE.height)
  })
})

describe('parseDesktopSettings', () => {
  test('reads valid settings and ignores anything malformed', () => {
    const bounds = { x: 1, y: 2, width: 800, height: 600 }

    expect(parseDesktopSettings(JSON.stringify({ bounds, maximized: true }))).toEqual({ bounds, maximized: true })
    expect(parseDesktopSettings(JSON.stringify({ bounds: { x: 'a' }, maximized: 'yes' }))).toEqual({ bounds: null, maximized: false })
    expect(parseDesktopSettings('not json')).toEqual({ bounds: null, maximized: false })
  })
})
