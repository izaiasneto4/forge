import { isIP } from 'node:net'

// Port of ActionDispatch::HostAuthorization. Like Rails, development allows
// .localhost, .test and any IP (what stops DNS-rebinding pages from reaching the
// API) and production allows every host. FORGE_ALLOWED_HOSTS overrides both: a
// comma list where a leading "." also allows subdomains, or "*" for any host.
export const DEFAULT_ALLOWED_HOSTS = ['.localhost', '.test']
export const ALLOW_ALL_HOSTS = ['*']

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

// Rails checks Host and the last X-Forwarded-Host entry.
export function requestHostAllowed(request: Request, allowedHosts: string[]) {
  const forwarded = request.headers.get('x-forwarded-host')?.split(/,\s?/).at(-1)
  if (forwarded && !isAllowedHost(forwarded, allowedHosts)) return false
  return isAllowedHost(request.headers.get('host') ?? new URL(request.url).host, allowedHosts)
}

// ActionCable's allow_request_origin?: same origin as the Host header, plus
// any localhost port in development (Rails' default allowed_request_origins).
export function cableOriginAllowed(request: Request, options: { development: boolean }) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (origin === null) return false
  const scheme = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || new URL(request.url).protocol.replace(':', '')
  if (host !== null && origin === `${scheme}://${host}`) return true
  return options.development && /^https?:\/\/localhost:\d+$/.test(origin)
}

export function blockedHostResponse(request: Request) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  return new Response(`Blocked hosts: ${host}`, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
