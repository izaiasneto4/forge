import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createApp } from '../../src/app'
import { ERROR_CODES } from '../../src/http/envelope'
import { createTestDatabase } from '../support/database'

const appOrigin = 'http://localhost'

describe('rails proxy fallback', () => {
  let fakeRails: ReturnType<typeof Bun.serve>

  beforeAll(() => {
    fakeRails = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        const body = request.method === 'GET' ? null : await request.text()
        return Response.json(
          { ok: true, method: request.method, path: `${url.pathname}${url.search}`, body },
          { headers: { 'x-served-by': 'rails' } },
        )
      },
    })
  })

  afterAll(() => fakeRails.stop(true))

  function appWithRails(railsUrl: string) {
    return createApp({ db: createTestDatabase(), railsUrl })
  }

  test('forwards unported routes to Rails with method, query and body intact', async () => {
    const path = '/api/v1/pull_requests/board?repo=acme%2Fapi'
    const method = 'PATCH'
    const payload = JSON.stringify({ theme_preference: 'light' })
    const app = appWithRails(fakeRails.url.origin)

    const response = await app.handle(
      new Request(`${appOrigin}${path}`, { method, body: payload, headers: { 'content-type': 'application/json' } }),
    )

    expect(response.headers.get('x-served-by')).toBe('rails')
    expect(await response.json()).toEqual({ ok: true, method, path, body: payload })
  })

  test('forwards other methods on a path that is only partly ported', async () => {
    const path = '/api/v1/settings'
    const method = 'PATCH'
    const app = appWithRails(fakeRails.url.origin)

    const response = await app.handle(new Request(`${appOrigin}${path}`, { method, body: '{}' }))

    expect(response.headers.get('x-served-by')).toBe('rails')
    expect(await response.json()).toMatchObject({ method, path })
  })

  test('serves ported routes without touching Rails', async () => {
    const path = '/api/v1/settings'
    const app = appWithRails(fakeRails.url.origin)

    const response = await app.handle(new Request(`${appOrigin}${path}`))

    expect(response.headers.get('x-served-by')).toBeNull()
    expect(await response.json()).toMatchObject({ ok: true })
  })

  test('returns a 502 error envelope when Rails is unreachable', async () => {
    const unreachableRailsUrl = 'http://127.0.0.1:1'
    const app = appWithRails(unreachableRailsUrl)

    const response = await app.handle(new Request(`${appOrigin}/api/v1/status`))

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: ERROR_CODES.upstreamUnavailable } })
  })
})
