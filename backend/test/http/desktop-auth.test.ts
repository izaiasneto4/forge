import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtimeConfig } from '../../src/config'
import { bearerToken, tokensMatch } from '../../src/http/desktop-auth'
import { ERROR_CODES } from '../../src/http/envelope'
import { startServer } from '../../src/server'
import { createTestApp } from '../support/app'
import { createTestContext, type TestContext } from '../support/context'

const origin = 'http://127.0.0.1:3100'
const desktopToken = 'a'.repeat(64)

function apiRequest(headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/v1/status`, { headers })
}

describe('desktop token helpers', () => {
  test('matches only the exact token', () => {
    const shorterGuess = desktopToken.slice(1)

    expect(tokensMatch(desktopToken, desktopToken)).toBe(true)
    expect(tokensMatch(desktopToken, shorterGuess)).toBe(false)
    expect(tokensMatch(desktopToken, '')).toBe(false)
  })

  test('reads only Bearer credentials', () => {
    expect(bearerToken(apiRequest({ authorization: `Bearer ${desktopToken}` }))).toBe(desktopToken)
    expect(bearerToken(apiRequest({ authorization: `Basic ${desktopToken}` }))).toBeNull()
    expect(bearerToken(apiRequest())).toBeNull()
  })
})

describe('desktop token on the app', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('rejects API requests without the token using the error envelope', async () => {
    const app = createTestApp(ctx, {}, { desktopToken })

    const response = await app.handle(apiRequest())

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false, error: { code: ERROR_CODES.unauthorized, message: expect.any(String) } })
  })

  test('rejects API requests with a wrong token', async () => {
    const app = createTestApp(ctx, {}, { desktopToken })

    const response = await app.handle(apiRequest({ authorization: `Bearer ${desktopToken.toUpperCase()}` }))

    expect(response.status).toBe(401)
  })

  test('serves API requests that carry the token', async () => {
    const app = createTestApp(ctx, {}, { desktopToken })

    const response = await app.handle(apiRequest({ authorization: `Bearer ${desktopToken}` }))

    expect(response.status).toBe(200)
  })

  test('keeps /up and static files open', async () => {
    const app = createTestApp(ctx, {}, { desktopToken })

    const up = await app.handle(new Request(`${origin}/up`))
    const icon = await app.handle(new Request(`${origin}/icon.svg`))

    expect(up.status).toBe(200)
    expect(icon.status).toBe(200)
  })

  test('rejects a websocket upgrade without the query token', async () => {
    const app = createTestApp(ctx, {}, { desktopToken })

    const viteOrigin = 'http://localhost:5173'

    const response = await app.handle(new Request(`${origin}/ws`, { headers: { upgrade: 'websocket', origin: viteOrigin } }))

    expect(response.status).toBe(401)
  })

  test('leaves the API open when no token is configured', async () => {
    const app = createTestApp(ctx)

    const response = await app.handle(apiRequest())

    expect(response.status).toBe(200)
  })
})

describe('desktop token on a running server', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ordem-desktop-auth-'))
  })

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }))

  function openSocket(url: string, socketOrigin: string) {
    const client = new WebSocket(url, { headers: { origin: socketOrigin } })
    return new Promise<'open' | 'rejected'>((resolve) => {
      // Bun dispatches close synchronously inside close(), so settle first.
      client.addEventListener('open', () => {
        resolve('open')
        client.close()
      })
      client.addEventListener('error', () => resolve('rejected'))
      client.addEventListener('close', () => resolve('rejected'))
    })
  }

  test('accepts the /ws upgrade only with ?token=', async () => {
    const config = runtimeConfig({ PORT: '0', DATABASE_PATH: join(tempDir, 'ordem.sqlite3'), ORDEM_DESKTOP_TOKEN: desktopToken })
    const server = startServer({ config, jobWorker: false })
    const serverOrigin = `http://localhost:${server.port}`
    const socketUrl = `ws://localhost:${server.port}/ws`

    try {
      expect(await openSocket(socketUrl, serverOrigin)).toBe('rejected')
      expect(await openSocket(`${socketUrl}?token=wrong`, serverOrigin)).toBe('rejected')
      expect(await openSocket(`${socketUrl}?token=${desktopToken}`, serverOrigin)).toBe('open')
    } finally {
      await server.stop()
    }
  }, 15_000)
})
