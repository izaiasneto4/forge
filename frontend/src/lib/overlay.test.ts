import { afterEach, describe, expect, it } from 'vitest'

import { overlayOpen } from './overlay'

describe('overlayOpen', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('detects dialogs, alerts and menus', () => {
    const roles = ['dialog', 'alertdialog', 'menu']

    expect(overlayOpen()).toBe(false)

    for (const role of roles) {
      const overlay = document.createElement('div')
      overlay.setAttribute('role', role)
      document.body.append(overlay)

      expect(overlayOpen()).toBe(true)
      overlay.remove()
    }
  })
})
