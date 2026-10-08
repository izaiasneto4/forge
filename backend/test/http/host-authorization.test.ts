import { describe, expect, test } from 'bun:test'
import { allowedHostsFromEnv, DEFAULT_ALLOWED_HOSTS, DESKTOP_RENDERER_ORIGINS, isAllowedHost, requestHostAllowed, websocketOriginAllowed } from '../../src/http/host-authorization'

function requestWith(headers: Record<string, string>, url = 'http://localhost:3100/ws') {
  return new Request(url, { headers })
}

describe('host authorization', () => {
  test.each(['localhost:3100', 'ordem.localhost', 'ordem.test:3000', '127.0.0.1:3000', '[::1]:3000', '192.168.2.6'])('allows %p by default', (host) => {
    expect(isAllowedHost(host, DEFAULT_ALLOWED_HOSTS)).toBe(true)
  })

  test.each(['attacker.example', 'localhost.attacker.example', 'test.example'])('blocks %p by default', (host) => {
    expect(isAllowedHost(host, DEFAULT_ALLOWED_HOSTS)).toBe(false)
  })

  test('honors ORDEM_ALLOWED_HOSTS, including subdomain and wildcard entries', () => {
    const allowed = allowedHostsFromEnv('ordem.example.com, .internal')

    expect(isAllowedHost('ordem.example.com', allowed)).toBe(true)
    expect(isAllowedHost('api.internal', allowed)).toBe(true)
    expect(isAllowedHost('localhost', allowed)).toBe(false)
    expect(isAllowedHost('anything.example', allowedHostsFromEnv('*'))).toBe(true)
  })

  test('checks X-Forwarded-Host too', () => {
    const request = requestWith({ host: 'localhost:3100', 'x-forwarded-host': 'attacker.example' })

    expect(requestHostAllowed(request, DEFAULT_ALLOWED_HOSTS)).toBe(false)
  })

  test('accepts same-origin websocket requests, and localhost ports only in development', () => {
    const sameOrigin = requestWith({ host: 'ordem.example.com', origin: 'http://ordem.example.com' }, 'http://ordem.example.com/ws')
    const viteDevServer = requestWith({ host: 'localhost:3100', origin: 'http://localhost:5173' })
    const crossSite = requestWith({ host: 'localhost:3100', origin: 'https://evil.example' })

    expect(websocketOriginAllowed(sameOrigin, { development: false })).toBe(true)
    expect(websocketOriginAllowed(viteDevServer, { development: true })).toBe(true)
    expect(websocketOriginAllowed(viteDevServer, { development: false })).toBe(false)
    expect(websocketOriginAllowed(crossSite, { development: true })).toBe(false)
  })

  test.each([...DESKTOP_RENDERER_ORIGINS])('accepts websocket requests from the desktop renderer %p', (origin) => {
    const desktopRequest = requestWith({ host: '127.0.0.1:51234', origin }, 'http://127.0.0.1:51234/ws')

    expect(websocketOriginAllowed(desktopRequest, { development: false })).toBe(true)
  })
})
