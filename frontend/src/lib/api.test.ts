import { afterEach, describe, expect, it, vi } from 'vitest'

import { fakeLocalEnvironment, installDesktopBridge, removeDesktopBridge } from '../test/desktopBridge'
import { api, ApiResponseError } from './api'

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    removeDesktopBridge()
  })

  function recordingFetch() {
    return vi.fn(async (_input: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ ok: true }) }))
  }

  it('calls same-origin paths with cookies and no authorization in a browser', async () => {
    const fetchSpy = recordingFetch()
    vi.stubGlobal('fetch', fetchSpy)
    const path = '/api/v1/settings'

    await api.get(path)

    const [input, init] = fetchSpy.mock.calls[0] ?? []
    expect(input).toBe(path)
    expect(init?.credentials).toBe('same-origin')
    expect(new Headers(init?.headers).get('authorization')).toBeNull()
  })

  it('calls the sidecar with the bearer token and no cookies on desktop', async () => {
    installDesktopBridge()
    const fetchSpy = recordingFetch()
    vi.stubGlobal('fetch', fetchSpy)
    const path = '/api/v1/settings'
    const body = { theme_preference: 'dark' }

    await api.patch(path, body)

    const [input, init] = fetchSpy.mock.calls[0] ?? []
    const headers = new Headers(init?.headers)
    expect(input).toBe(`${fakeLocalEnvironment.httpBaseUrl}${path}`)
    expect(init?.credentials).toBe('omit')
    expect(headers.get('authorization')).toBe(`Bearer ${fakeLocalEnvironment.token}`)
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('unwraps successful envelopes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, value: 42 }),
    })))

    await expect(api.get<{ value: number }>('/api/v1/bootstrap')).resolves.toEqual({ value: 42 })
  })

  it('raises ApiResponseError for error envelopes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: async () => ({ ok: false, error: { code: 'invalid_input', message: 'bad request' } }),
    })))

    await expect(api.get('/api/v1/bootstrap')).rejects.toBeInstanceOf(ApiResponseError)
  })
})
