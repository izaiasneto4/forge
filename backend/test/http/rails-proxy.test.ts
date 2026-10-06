import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createApp } from '../../src/app'
import { ERROR_CODES } from '../../src/http/envelope'
import { railsTargetUrl } from '../../src/http/rails-proxy'
import { createTestDatabase } from '../support/database'

const appOrigin = 'http://localhost'
const slowPath = '/api/v1/repositories'
// Bun enforces idle timeouts on a global ~4s tick, so a 1s timeout drops an
// idle GET within ~5s; a 6s Rails response is reliably past that point.
const shortIdleTimeoutSeconds = 1
const slowRailsDelayMs = 6000
const slowTestTimeoutMs = 12_000

describe('rails proxy fallback', () => {
  let fakeRails: ReturnType<typeof Bun.serve>
  let otherHost: ReturnType<typeof Bun.serve>
  const otherHostHits: string[] = []

  beforeAll(() => {
    fakeRails = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === slowPath) await Bun.sleep(slowRailsDelayMs)
        const body = request.method === 'GET' ? null : await request.text()
        return Response.json(
          {
            ok: true,
            method: request.method,
            path: `${url.pathname}${url.search}`,
            body,
            keepAlive: request.headers.get('keep-alive'),
            proxyConnection: request.headers.get('proxy-connection'),
          },
          { headers: { 'x-served-by': 'rails' } },
        )
      },
    })
    otherHost = Bun.serve({
      port: 0,
      fetch(request) {
        otherHostHits.push(request.url)
        return new Response('other host')
      },
    })
  })

  afterAll(() => {
    fakeRails.stop(true)
    otherHost.stop(true)
  })

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
    expect(await response.json()).toMatchObject({ ok: true, method, path, body: payload })
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

  test('keeps protocol-relative paths on the Rails origin instead of following them to another host', async () => {
    const protocolRelativePath = `//localhost:${otherHost.port}/steal`
    const app = appWithRails(fakeRails.url.origin)

    const response = await app.handle(new Request(`${appOrigin}${protocolRelativePath}`, { headers: { cookie: 'session=secret' } }))

    expect(response.headers.get('x-served-by')).toBe('rails')
    expect(otherHostHits).toEqual([])
  })

  test('builds the Rails URL from the client path and query only', () => {
    const railsOrigin = 'http://127.0.0.1:3000'
    const pathAndQuery = '//attacker.example/steal?token=1'

    const target = railsTargetUrl(`${appOrigin}${pathAndQuery}`, railsOrigin)

    expect(target.href).toBe(`${railsOrigin}${pathAndQuery}`)
  })

  test('strips hop-by-hop headers before forwarding', async () => {
    const app = appWithRails(fakeRails.url.origin)

    const response = await app.handle(
      new Request(`${appOrigin}/api/v1/status`, { headers: { 'keep-alive': 'timeout=99', 'proxy-connection': 'keep-alive' } }),
    )

    expect(await response.json()).toMatchObject({ keepAlive: null, proxyConnection: null })
  })

  test('lets slow Rails requests outlast the idle timeout', async () => {
    const app = appWithRails(fakeRails.url.origin).listen({ port: 0, idleTimeout: shortIdleTimeoutSeconds })

    try {
      const response = await fetch(`http://localhost:${app.server?.port}${slowPath}`)

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ path: slowPath })
    } finally {
      await app.stop(true)
    }
  }, slowTestTimeoutMs)

  test('returns a 502 error envelope when Rails is unreachable', async () => {
    const unreachableRailsUrl = 'http://127.0.0.1:1'
    const app = appWithRails(unreachableRailsUrl)

    const response = await app.handle(new Request(`${appOrigin}/api/v1/status`))

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: ERROR_CODES.upstreamUnavailable } })
  })
})
