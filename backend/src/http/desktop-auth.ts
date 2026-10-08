import { createHash, timingSafeEqual } from 'node:crypto'
import { ERROR_CODES } from './envelope'

// The desktop shell starts the server with a per-launch ORDEM_DESKTOP_TOKEN.
// When set, /api/* needs `Authorization: Bearer <token>` and the /ws upgrade
// needs `?token=<token>`. /up (the readiness probe) and static files stay open.

const API_PREFIX = '/api/'
const BEARER_PREFIX = 'Bearer '

// Hashing first gives timingSafeEqual equal-length buffers, so a wrong guess
// does not leak the token's length either.
export function tokensMatch(expected: string, presented: string) {
  const expectedDigest = createHash('sha256').update(expected).digest()
  const presentedDigest = createHash('sha256').update(presented).digest()
  return timingSafeEqual(expectedDigest, presentedDigest)
}

export function bearerToken(request: Request) {
  const header = request.headers.get('authorization')
  if (header === null || !header.startsWith(BEARER_PREFIX)) return null
  return header.slice(BEARER_PREFIX.length).trim()
}

export function apiRequestAuthorized(request: Request, desktopToken: string) {
  const presented = bearerToken(request)
  return presented !== null && tokensMatch(desktopToken, presented)
}

export function websocketHandshakeAuthorized(request: Request, desktopToken: string) {
  const presented = new URL(request.url).searchParams.get('token')
  return presented !== null && tokensMatch(desktopToken, presented)
}

export function isApiPath(pathname: string) {
  return pathname.startsWith(API_PREFIX)
}

export function unauthorizedResponse(headers: Record<string, string> = {}) {
  const body = { ok: false, error: { code: ERROR_CODES.unauthorized, message: 'Missing or invalid desktop token' } }
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer', ...headers },
  })
}
