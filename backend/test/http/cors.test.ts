import { beforeEach, describe, expect, test } from 'bun:test'
import { DESKTOP_RENDERER_ORIGINS } from '../../src/http/host-authorization'
import { createTestApp } from '../support/app'
import { createTestContext, type TestContext } from '../support/context'

const apiUrl = 'http://127.0.0.1:3100/api/v1/settings'
const [packagedOrigin = '', developmentOrigin = ''] = DESKTOP_RENDERER_ORIGINS
const foreignOrigin = 'https://evil.example'
const desktopToken = 'b'.repeat(64)

function preflight(origin: string) {
  return new Request(apiUrl, {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'content-type, authorization' },
  })
}

describe('CORS for the desktop renderer', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test.each([packagedOrigin, developmentOrigin])('answers a PATCH preflight from %p with 204 before auth', async (origin) => {
    const app = createTestApp(ctx, {}, { desktopToken })

    const response = await app.handle(preflight(origin))

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('access-control-allow-methods')).toContain('PATCH')
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization')
    expect(response.headers.get('vary')).toBe('Origin')
  })

  test('adds CORS headers to authorized API responses', async () => {
    const app = createTestApp(ctx, {}, { desktopToken })

    const response = await app.handle(new Request(apiUrl, { headers: { origin: packagedOrigin, authorization: `Bearer ${desktopToken}` } }))

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(packagedOrigin)
  })

  test('adds CORS headers to a 401 so the renderer can read it', async () => {
    const app = createTestApp(ctx, {}, { desktopToken })

    const response = await app.handle(new Request(apiUrl, { headers: { origin: packagedOrigin } }))

    expect(response.status).toBe(401)
    expect(response.headers.get('access-control-allow-origin')).toBe(packagedOrigin)
  })

  test('adds CORS headers to API error envelopes', async () => {
    const app = createTestApp(ctx)
    const missingTaskUrl = 'http://127.0.0.1:3100/api/v1/review_tasks/999999'

    const response = await app.handle(new Request(missingTaskUrl, { headers: { origin: packagedOrigin } }))

    expect(response.status).toBe(404)
    expect(response.headers.get('access-control-allow-origin')).toBe(packagedOrigin)
  })

  test('gives other origins no CORS headers', async () => {
    const app = createTestApp(ctx)

    const preflightResponse = await app.handle(preflight(foreignOrigin))
    const getResponse = await app.handle(new Request(apiUrl, { headers: { origin: foreignOrigin } }))

    expect(preflightResponse.headers.get('access-control-allow-origin')).toBeNull()
    expect(getResponse.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('adds no CORS headers outside /api', async () => {
    const app = createTestApp(ctx)

    const response = await app.handle(new Request('http://127.0.0.1:3100/up', { headers: { origin: packagedOrigin } }))

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
