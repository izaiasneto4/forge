import { isApiPath } from './desktop-auth'
import { isDesktopRendererOrigin } from './host-authorization'

// The desktop renderer (ordem://app) is a different origin from the sidecar at
// 127.0.0.1:<port>, so its PATCH and DELETE calls are preflighted. Only desktop
// renderer origins get CORS headers; browsers keep blocking every other origin.

const ALLOWED_HEADERS = 'content-type, authorization'
const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS'
const PREFLIGHT_MAX_AGE_SECONDS = '600'

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  if (origin === null || !isDesktopRendererOrigin(origin) || !isApiPath(new URL(request.url).pathname)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': ALLOWED_HEADERS,
    'access-control-allow-methods': ALLOWED_METHODS,
    vary: 'Origin',
  }
}

// Answered before auth runs: browsers never attach credentials to a preflight.
export function preflightResponse(request: Request) {
  if (request.method !== 'OPTIONS') return null
  const headers = corsHeaders(request)
  if (Object.keys(headers).length === 0) return null
  return new Response(null, { status: 204, headers: { ...headers, 'access-control-max-age': PREFLIGHT_MAX_AGE_SECONDS } })
}
