import { Elysia } from 'elysia'
import { ApiError, ERROR_CODES } from './envelope'

const BODYLESS_METHODS = new Set(['GET', 'HEAD'])

// Bun's fetch decompresses bodies, so encoding/length headers no longer apply.
const STALE_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding']

async function forwardToRails(request: Request, railsUrl: string) {
  const incomingUrl = new URL(request.url)
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, railsUrl)
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.set('x-forwarded-host', incomingUrl.host)
  headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''))

  let railsResponse: Response
  try {
    railsResponse = await fetch(targetUrl, {
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
  return new Elysia({ name: 'rails-proxy' }).all('*', ({ request }) => forwardToRails(request, railsUrl))
}
