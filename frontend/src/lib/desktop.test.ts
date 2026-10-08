import { afterEach, describe, expect, it } from 'vitest'

import { fakeLocalEnvironment, installDesktopBridge, removeDesktopBridge } from '../test/desktopBridge'
import { apiBase, applyDesktopPlatform, authHeaders, isDesktop, wsUrl } from './desktop'

describe('desktop helpers', () => {
  afterEach(() => removeDesktopBridge())

  it('stays same-origin in a browser', () => {
    const sameOriginSocket = `ws://${window.location.host}/ws`

    expect(isDesktop()).toBe(false)
    expect(apiBase()).toBe('')
    expect(authHeaders()).toEqual({})
    expect(wsUrl()).toBe(sameOriginSocket)
  })

  it('targets the sidecar with the token on desktop', () => {
    installDesktopBridge()
    const expectedSocket = `${fakeLocalEnvironment.wsBaseUrl}/ws?token=${fakeLocalEnvironment.token}`

    expect(isDesktop()).toBe(true)
    expect(apiBase()).toBe(fakeLocalEnvironment.httpBaseUrl)
    expect(authHeaders()).toEqual({ Authorization: `Bearer ${fakeLocalEnvironment.token}` })
    expect(wsUrl()).toBe(expectedSocket)
  })
})

describe('applyDesktopPlatform', () => {
  afterEach(() => removeDesktopBridge())

  it('marks the root with the bridge platform only on desktop', () => {
    const browserRoot = document.createElement('html')
    const desktopRoot = document.createElement('html')
    const bridge = installDesktopBridge()

    applyDesktopPlatform(desktopRoot)
    removeDesktopBridge()
    applyDesktopPlatform(browserRoot)

    expect(desktopRoot.dataset.platform).toBe(bridge.platform)
    expect(browserRoot.dataset.platform).toBeUndefined()
  })
})
