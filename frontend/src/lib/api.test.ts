import { describe, expect, it, vi } from 'vitest'

import { api, ApiResponseError } from './api'

describe('api client', () => {
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
