import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONTENT_SECURITY_POLICY, mimeType, publicFile, resolveDevProtocolRoute, resolveProtocolRoute } from '../src/protocol-routes'

const devServerUrl = 'http://localhost:5173'

describe('ordem://app routes', () => {
  let publicDir: string
  let indexFile: string
  let assetFile: string
  let iconFile: string

  beforeAll(() => {
    publicDir = realpathSync(mkdtempSync(join(tmpdir(), 'ordem-public-')))
    mkdirSync(join(publicDir, 'frontend', 'assets'), { recursive: true })
    indexFile = join(publicDir, 'frontend', 'index.html')
    assetFile = join(publicDir, 'frontend', 'assets', 'index-abc.js')
    iconFile = join(publicDir, 'icon.svg')
    writeFileSync(indexFile, '<!doctype html>')
    writeFileSync(assetFile, 'console.log(1)')
    writeFileSync(iconFile, '<svg/>')
  })

  afterAll(() => rmSync(publicDir, { recursive: true, force: true }))

  test('serves built assets and public files from disk', () => {
    expect(resolveProtocolRoute(new URL('ordem://app/frontend/assets/index-abc.js'), publicDir)).toEqual({ kind: 'file', path: assetFile })
    expect(resolveProtocolRoute(new URL('ordem://app/icon.svg'), publicDir)).toEqual({ kind: 'file', path: iconFile })
  })

  test.each(['ordem://app/', 'ordem://app/inbox/12', 'ordem://app/settings', 'ordem://app/review_tasks/3'])('falls back to the SPA index for %p', (url) => {
    expect(resolveProtocolRoute(new URL(url), publicDir)).toEqual({ kind: 'index', path: indexFile })
  })

  test('answers 404 for a missing asset instead of the index', () => {
    expect(resolveProtocolRoute(new URL('ordem://app/missing.js'), publicDir)).toEqual({ kind: 'not-found' })
  })

  test('refuses other hosts and paths escaping public/', () => {
    expect(resolveProtocolRoute(new URL('ordem://elsewhere/icon.svg'), publicDir)).toEqual({ kind: 'not-found' })
    expect(publicFile(publicDir, '/../../etc/hosts')).toBeNull()
    expect(publicFile(publicDir, '/%2e%2e/%2e%2e/etc/hosts')).toBeNull()
  })

  test('proxies Vite paths and SPA routes in development, public files from disk', () => {
    expect(resolveDevProtocolRoute(new URL('ordem-dev://app/frontend/src/main.tsx?t=1'), publicDir, devServerUrl)).toEqual({ kind: 'proxy', url: `${devServerUrl}/frontend/src/main.tsx?t=1` })
    expect(resolveDevProtocolRoute(new URL('ordem-dev://app/inbox'), publicDir, devServerUrl)).toEqual({ kind: 'proxy', url: `${devServerUrl}/frontend/` })
    expect(resolveDevProtocolRoute(new URL('ordem-dev://app/icon.svg'), publicDir, devServerUrl)).toEqual({ kind: 'file', path: iconFile })
  })

  test('limits connections to the loopback server and types common files', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'")
    expect(CONTENT_SECURITY_POLICY).toContain('connect-src')
    expect(CONTENT_SECURITY_POLICY).toContain('http://127.0.0.1:*')
    expect(mimeType(assetFile)).toStartWith('text/javascript')
    expect(mimeType(indexFile)).toStartWith('text/html')
  })
})
