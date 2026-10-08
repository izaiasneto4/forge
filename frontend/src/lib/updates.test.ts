import { describe, expect, it } from 'vitest'

import { fakeUpdateState } from '../test/desktopBridge'
import { updateSummary } from './updates'

describe('updateSummary', () => {
  it('names the version that is downloading and its progress', () => {
    const availableVersion = '1.4.0'
    const downloadPercent = 42

    const summary = updateSummary({ ...fakeUpdateState, status: 'downloading', availableVersion, downloadPercent })

    expect(summary.label).toContain(availableVersion)
    expect(summary.hint).toBe(`${downloadPercent}%`)
  })

  it('shows the updater error as the hint', () => {
    const error = 'net::ERR_INTERNET_DISCONNECTED'

    expect(updateSummary({ ...fakeUpdateState, status: 'error', error }).hint).toBe(error)
  })
})
