import { describe, expect, it } from 'vitest'

import { ACCENTS, contrastRatio, DARK_ON_ACCENT, LIGHT_ON_ACCENT, onAccentColor } from './preferences'

const WCAG_AA = 4.5

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
