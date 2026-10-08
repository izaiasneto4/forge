import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import {
  APP_SCHEME,
  CONTENT_SECURITY_POLICY,
  DEV_APP_SCHEME,
  mimeType,
  resolveDevProtocolRoute,
  resolveProtocolRoute,
  type ProtocolRoute,
} from './protocol-routes'

const DEV_PROXY_ATTEMPTS = 20
const DEV_PROXY_RETRY_MS = 250

// Must run before app.whenReady(). A standard, secure scheme gives the renderer a
// stable origin (localStorage survives port changes) and lets it use fetch and CORS.
export function registerSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
    { scheme: DEV_APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ])
}

function notFound() {
  return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

async function serveRoute(route: ProtocolRoute, csp: string | null) {
  if (route.kind === 'not-found') return notFound()
  try {
    const body = await readFile(route.path)
    const headers: Record<string, string> = { 'content-type': mimeType(route.path) }
    if (csp) headers['content-security-policy'] = csp
    if (route.kind === 'index') headers['cache-control'] = 'no-cache'
    return new Response(body, { status: 200, headers })
  } catch {
    return notFound()
  }
}

export function handleAppProtocol(publicDir: string) {
  protocol.handle(APP_SCHEME, (request) => serveRoute(resolveProtocolRoute(new URL(request.url), publicDir), CONTENT_SECURITY_POLICY))
}

async function proxyWithRetry(url: string, request: Request) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { method: request.method, headers: request.headers })
      return new Response(response.body, { status: response.status, headers: response.headers })
    } catch (error) {
      // Vite restarts on config changes; wait for it instead of failing the page.
      if (attempt >= DEV_PROXY_ATTEMPTS) throw error
      await new Promise((resolve) => setTimeout(resolve, DEV_PROXY_RETRY_MS))
    }
  }
}

// Development only: proxies to Vite. No CSP, since Vite injects inline scripts for HMR.
export function handleDevAppProtocol(publicDir: string, devServerUrl: string) {
  protocol.handle(DEV_APP_SCHEME, async (request) => {
    const route = resolveDevProtocolRoute(new URL(request.url), publicDir, devServerUrl)
    if (route.kind !== 'proxy') return serveRoute(route, null)
    try {
      return await proxyWithRetry(route.url, request)
    } catch {
      return new Response(`Vite is not answering at ${devServerUrl}`, { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    }
  })
}
