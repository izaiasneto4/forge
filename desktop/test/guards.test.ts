import { describe, expect, test } from 'bun:test'
import { badgeCount, isBackendState, isExternalUrl, isLocalEnvironment, isUpdateState, pickFolderOptions } from '../src/guards'

describe('IPC guards', () => {
  test('lets only https links leave the app', () => {
    expect(isExternalUrl('https://github.com/acme/api/pull/1')).toBe(true)
    expect(isExternalUrl('http://example.com')).toBe(false)
    expect(isExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalUrl(42)).toBe(false)
  })

  test('narrows the picker options to a non-empty initial path', () => {
    const initialPath = '/Users/dev/code'

    expect(pickFolderOptions({ initialPath })).toEqual({ initialPath })
    expect(pickFolderOptions({ initialPath: '' })).toEqual({})
    expect(pickFolderOptions('nope')).toEqual({})
  })

  test('recognises environments and update states', () => {
    const environment = { httpBaseUrl: 'http://127.0.0.1:1', wsBaseUrl: 'ws://127.0.0.1:1', token: 't' }
    const state = { status: 'downloading', currentVersion: '1.0.0', availableVersion: '1.1.0', downloadPercent: 40, error: null, checkedAt: null }

    expect(isLocalEnvironment(environment)).toBe(true)
    expect(isLocalEnvironment({ ...environment, token: 1 })).toBe(false)
    expect(isUpdateState(state)).toBe(true)
    expect(isUpdateState({ ...state, status: 'exploded' })).toBe(false)
  })

  test('accepts only whole, non-negative badge counts', () => {
    const pending = 7

    expect(badgeCount(pending)).toBe(pending)
    expect(badgeCount(-1)).toBe(0)
    expect(badgeCount(2.5)).toBe(0)
    expect(badgeCount('3')).toBe(0)
  })

  test('recognises backend states', () => {
    expect(isBackendState({ status: 'restarting', message: null })).toBe(true)
    expect(isBackendState({ status: 'exploded', message: null })).toBe(false)
  })
})
