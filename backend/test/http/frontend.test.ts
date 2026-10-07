import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { frontendRoutes, publicFilePath } from '../../src/http/frontend'

const origin = 'http://localhost:3100'
const indexHtml = '<!doctype html><title>Forge</title>'
const assetBody = 'console.log("app")'
const notFoundHtml = '<h1>The page you were looking for does not exist.</h1>'
const frontendDevUrl = 'http://localhost:5173'

describe('frontend routes', () => {
  let publicDir: string
  let emptyPublicDir: string

  beforeAll(() => {
    publicDir = realpathSync(mkdtempSync(join(tmpdir(), 'forge-public-')))
    emptyPublicDir = realpathSync(mkdtempSync(join(tmpdir(), 'forge-public-empty-')))
    mkdirSync(join(publicDir, 'frontend', 'assets'), { recursive: true })
    writeFileSync(join(publicDir, 'frontend', 'index.html'), indexHtml)
    writeFileSync(join(publicDir, 'frontend', 'assets', 'app.js'), assetBody)
    writeFileSync(join(publicDir, '404.html'), notFoundHtml)
  })

  afterAll(() => {
    rmSync(publicDir, { recursive: true, force: true })
    rmSync(emptyPublicDir, { recursive: true, force: true })
  })

  function app(dir: string, development = false) {
    return frontendRoutes({ publicDir: dir, development, frontendDevUrl })
  }

  test.each(['/', '/review_tasks', '/review_tasks/12', '/repositories', '/settings'])('serves the SPA shell at %p', async (path) => {
    const response = await app(publicDir).handle(new Request(`${origin}${path}`))

    expect(await response.text()).toBe(indexHtml)
  })

  test('serves built assets with long-lived caching in production', async () => {
    const response = await app(publicDir).handle(new Request(`${origin}/frontend/assets/app.js`))

    expect(await response.text()).toBe(assetBody)
    expect(response.headers.get('cache-control')).toBe(`public, max-age=${365 * 24 * 3600}`)
  })

  test('answers /up for health checks', async () => {
    const response = await app(publicDir).handle(new Request(`${origin}/up`))

    expect(response.status).toBe(200)
  })

  test('renders the public 404 page for unknown paths and refuses traversal', async () => {
    const unknown = await app(publicDir).handle(new Request(`${origin}/nope`))

    expect(unknown.status).toBe(404)
    expect(await unknown.text()).toBe(notFoundHtml)
    expect(publicFilePath(publicDir, '/../../etc/passwd')).toBeNull()
    expect(publicFilePath(publicDir, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull()
  })

  test('redirects to the Vite dev server when no build exists in development', async () => {
    const path = '/settings'

    const response = await app(emptyPublicDir, true).handle(new Request(`${origin}${path}?tab=1`))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${frontendDevUrl}${path}?tab=1`)
  })

  test('reports a missing build in production', async () => {
    const response = await app(emptyPublicDir).handle(new Request(`${origin}/`))

    expect(response.status).toBe(503)
  })
})
