import { isIP } from 'node:net'

// Development allows .localhost, .test and any IP (what stops DNS-rebinding
// pages from reaching the API). Production allows every host.
// ORDEM_ALLOWED_HOSTS overrides both: a comma list where a leading "." also
// allows subdomains, or "*" for any host.
export const DEFAULT_ALLOWED_HOSTS = ['.localhost', '.test']
export const ALLOW_ALL_HOSTS = ['*']

// Where the desktop renderer runs: the packaged app and the development shell.
// The only cross-origin callers the API answers (websocket origin check and CORS).
export const DESKTOP_RENDERER_ORIGINS: readonly string[] = Object.freeze(['ordem://app', 'ordem-dev://app'])

export function isDesktopRendererOrigin(origin: string | null) {
  return origin !== null && DESKTOP_RENDERER_ORIGINS.includes(origin)
}

export function allowedHostsFromEnv(value: string | undefined, development = true) {
  if (value === undefined || value.trim() === '') return development ? DEFAULT_ALLOWED_HOSTS : ALLOW_ALL_HOSTS
  return value
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== '')
}

export function hostnameOf(hostWithPort: string) {
  const trimmed = hostWithPort.trim().toLowerCase()
  if (trimmed.startsWith('[')) return trimmed.slice(1, trimmed.indexOf(']'))
  return trimmed.replace(/:\d+$/, '')
}

export function isAllowedHost(hostWithPort: string | null, allowedHosts: string[]) {
  if (allowedHosts.includes('*')) return true
  if (hostWithPort === null || hostWithPort === '') return false
  const hostname = hostnameOf(hostWithPort)
  if (isIP(hostname) !== 0) return true
  return allowedHosts.some((allowed) =>
    allowed.startsWith('.') ? hostname === allowed.slice(1) || hostname.endsWith(allowed) : hostname === allowed,
  )
}

export function requestHostAllowed(request: Request, allowedHosts: string[]) {
  const forwarded = request.headers.get('x-forwarded-host')?.split(/,\s?/).at(-1)
  if (forwarded && !isAllowedHost(forwarded, allowedHosts)) return false
  return isAllowedHost(request.headers.get('host') ?? new URL(request.url).host, allowedHosts)
}

// Same origin as the Host header, the desktop renderer, plus any localhost port in development.
export function websocketOriginAllowed(request: Request, options: { development: boolean }) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (origin === null) return false
  if (isDesktopRendererOrigin(origin)) return true
  const scheme = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || new URL(request.url).protocol.replace(':', '')
  if (host !== null && origin === `${scheme}://${host}`) return true
  return options.development && /^https?:\/\/localhost:\d+$/.test(origin)
}

export function blockedHostResponse(request: Request) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  return new Response(`Blocked hosts: ${host}`, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
