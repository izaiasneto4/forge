import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ACCENTS, contrastRatio, DARK_ON_ACCENT, desktopNotificationsEnabled, LIGHT_ON_ACCENT, onAccentColor, storedAccent } from './preferences'

const WCAG_AA = 4.5

describe('upgraded preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('Notification', { permission: 'granted' })
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('keeps an existing accent until the user saves an Ordem preference', () => {
    const legacyAccent = '#0a84ff'
    const ordemAccent = '#bf5af2'
    localStorage.setItem('forge.accent', legacyAccent)

    expect(storedAccent()).toBe(legacyAccent)

    localStorage.setItem('ordem.accent', ordemAccent)
    expect(storedAccent()).toBe(ordemAccent)
  })

  it('keeps existing notification consent and lets a new off setting override it', () => {
    localStorage.setItem('forge.notify', 'on')

    expect(desktopNotificationsEnabled()).toBe(true)

    localStorage.setItem('ordem.notify', 'off')
    expect(desktopNotificationsEnabled()).toBe(false)
  })
})

describe('onAccentColor', () => {
  it('keeps button text readable on every accent', () => {
    for (const accent of ACCENTS) {
      expect(contrastRatio(onAccentColor(accent), accent)).toBeGreaterThanOrEqual(WCAG_AA)
    }
  })

  it('uses white only where white is readable', () => {
    const darkAccent = '#1d4ed8'
    const brightAccent = '#ffd60a'

    expect(onAccentColor(darkAccent)).toBe(LIGHT_ON_ACCENT)
    expect(onAccentColor(brightAccent)).toBe(DARK_ON_ACCENT)
  })
})
