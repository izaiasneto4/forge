import { Elysia } from 'elysia'
import { ApiError, ERROR_CODES } from './envelope'

const BODYLESS_METHODS = new Set(['GET', 'HEAD'])

// Connection-scoped headers that must not cross a proxy hop.
const HOP_BY_HOP_HEADERS = ['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']

// Bun's fetch decompresses bodies, so encoding/length headers no longer apply.
const STALE_RESPONSE_HEADERS = ['content-encoding', 'content-length', ...HOP_BY_HOP_HEADERS]

// Only path and query come from the client. Resolving "//other-host/x" against
// railsUrl would switch hosts and leak the request (cookies, body) elsewhere.
export function railsTargetUrl(requestUrl: string, railsUrl: string) {
  const incomingUrl = new URL(requestUrl)
  const targetUrl = new URL(railsUrl)
  targetUrl.pathname = incomingUrl.pathname
  targetUrl.search = incomingUrl.search
  return targetUrl
}

async function forwardToRails(request: Request, railsUrl: string) {
  const incomingUrl = new URL(request.url)
  const headers = new Headers(request.headers)
  for (const header of ['host', ...HOP_BY_HOP_HEADERS]) {
    headers.delete(header)
  }
  headers.set('x-forwarded-host', incomingUrl.host)
  headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''))

  let railsResponse: Response
  try {
    railsResponse = await fetch(railsTargetUrl(request.url, railsUrl), {
      method: request.method,
      headers,
      body: BODYLESS_METHODS.has(request.method) ? undefined : await request.arrayBuffer(),
      redirect: 'manual',
    })
  } catch {
    throw new ApiError(ERROR_CODES.upstreamUnavailable, `Rails backend unreachable at ${railsUrl}`, 502)
  }

  const responseHeaders = new Headers(railsResponse.headers)
  for (const header of STALE_RESPONSE_HEADERS) {
    responseHeaders.delete(header)
  }

  return new Response(railsResponse.body, {
    status: railsResponse.status,
    statusText: railsResponse.statusText,
    headers: responseHeaders,
  })
}

// Strangler fallback: any route not yet ported is served by Rails.
export function railsProxy(railsUrl: string) {
  return new Elysia({ name: 'rails-proxy' }).all('*', ({ request, server }) => {
    // Rails decides how long a request may take; syncs and review submissions can
    // outlast Elysia's 30s idle timeout, which would drop the browser connection.
    server?.timeout(request, 0)
    return forwardToRails(request, railsUrl)
  })
}
