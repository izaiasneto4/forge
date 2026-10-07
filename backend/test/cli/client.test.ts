import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  ApiError,
  Client,
  ConnectionError,
  DEFAULT_API_URL,
  type FetchFunction,
  Interrupt,
} from '../../src/cli/client'
import { closedPortUrl } from './support'

const baseUrl = 'http://127.0.0.1:3000'
const prUrl = 'https://github.com/acme/api/pull/1'

interface SentRequest {
  url: URL
  method: string | undefined
  headers: Headers
  body: unknown
}

// Stands in for Net::HTTP: records each request and answers with a canned response.
function fakeHttp(status: number, body: string) {
  const requests: SentRequest[] = []
  const fetch: FetchFunction = async (url, init) => {
    const text = typeof init.body === 'string' ? init.body : ''
    requests.push({
      url,
      method: init.method,
      headers: new Headers(init.headers),
      body: text === '' ? undefined : JSON.parse(text),
    })
    return new Response(body, { status })
  }
  return { requests, fetch }
}

function okHttp(payload: unknown = { ok: true }) {
  return fakeHttp(200, JSON.stringify(payload))
}

// A fetch that only settles when its signal aborts.
const hangingFetch: FetchFunction = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })

describe('Client', () => {
  test('sync posts the payload and parses success', async () => {
    const payload = { ok: true, skipped: false }
    const http = okHttp(payload)
    const force = true

    const result = await new Client({ baseUrl, fetch: http.fetch }).sync({ force })

    expect(result).toEqual(payload)
    const [request] = http.requests
    expect(request?.method).toBe('POST')
    expect(request?.url.pathname).toBe('/api/v1/sync')
    expect(request?.headers.get('content-type')).toBe('application/json')
    expect(request?.body).toEqual({ force })
  })

  test('raises an api error on non-2xx', async () => {
    const status = 422
    const error = { code: 'invalid_input', message: 'bad' }
    const http = fakeHttp(status, JSON.stringify({ ok: false, error }))

    const failure = new Client({ baseUrl, fetch: http.fetch }).status()

    await expect(failure).rejects.toThrow(ApiError)
    await expect(failure).rejects.toMatchObject({ code: error.code, status, message: error.message })
  })

  test('raises a connection error with Net::HTTP wording when nothing listens', async () => {
    const closed = await closedPortUrl()
    const host = '127.0.0.1'

    const failure = new Client({ baseUrl: closed.url }).status()

    await expect(failure).rejects.toThrow(ConnectionError)
    await expect(failure).rejects.toThrow(
      `Failed to open TCP connection to ${host}:${closed.port} (Connection refused - connect(2) for "${host}" port ${closed.port})`,
    )
  })

  test('raises a connection error when the server does not answer in time', async () => {
    const failure = new Client({ baseUrl, fetch: hangingFetch, timeoutSeconds: 0.01 }).status()

    await expect(failure).rejects.toThrow(ConnectionError)
    await expect(failure).rejects.toThrow('Net::ReadTimeout')
  })

  test('raises Interrupt when the interrupt signal aborts a request', async () => {
    const interrupt = new AbortController()
    const request = new Client({ baseUrl, fetch: hangingFetch, signal: interrupt.signal }).status()

    interrupt.abort()

    await expect(request).rejects.toThrow(Interrupt)
  })

  test('handles an invalid json body', async () => {
    const http = fakeHttp(200, 'not json')

    expect(await new Client({ baseUrl, fetch: http.fetch }).status()).toEqual({})
  })

  test('handles an empty body', async () => {
    const http = fakeHttp(200, '')

    expect(await new Client({ baseUrl, fetch: http.fetch }).status()).toEqual({})
  })

  test('review includes optional payload fields', async () => {
    const http = okHttp()
    const cliClient = 'codex'
    const reviewType = 'swarm'

    await new Client({ baseUrl, fetch: http.fetch }).review({ prUrl, cliClient, reviewType })

    expect(http.requests[0]?.url.pathname).toBe('/api/v1/reviews')
    expect(http.requests[0]?.body).toEqual({ pr_url: prUrl, cli_client: cliClient, review_type: reviewType })
  })

  test('review omits optional payload fields', async () => {
    const http = okHttp()

    await new Client({ baseUrl, fetch: http.fetch }).review({ prUrl })

    expect(http.requests[0]?.body).toEqual({ pr_url: prUrl })
  })

  test('list includes query params when provided', async () => {
    const http = okHttp()
    const status = 'pending_review'
    const limit = 5

    await new Client({ baseUrl, fetch: http.fetch }).list({ status, limit })

    const url = http.requests[0]?.url
    expect(url?.pathname).toBe('/api/v1/pull_requests')
    expect(url?.searchParams.get('status')).toBe(status)
    expect(url?.searchParams.get('limit')).toBe(String(limit))
  })

  test('list omits query params when missing', async () => {
    const http = okHttp()

    await new Client({ baseUrl, fetch: http.fetch }).list()

    expect(http.requests[0]?.url.pathname).toBe('/api/v1/pull_requests')
    expect(http.requests[0]?.url.search).toBe('')
  })

  test('logs includes tail and after_id', async () => {
    const http = okHttp()
    const taskId = 1
    const tail = 10
    const afterId = 20

    await new Client({ baseUrl, fetch: http.fetch }).logs({ taskId, tail, afterId })

    const url = http.requests[0]?.url
    expect(url?.pathname).toBe(`/api/v1/review_tasks/${taskId}/logs`)
    expect(url?.searchParams.get('tail')).toBe(String(tail))
    expect(url?.searchParams.get('after_id')).toBe(String(afterId))
  })

  test('logs omits optional query params', async () => {
    const http = okHttp()
    const taskId = 1

    await new Client({ baseUrl, fetch: http.fetch }).logs({ taskId })

    expect(http.requests[0]?.url.pathname).toBe(`/api/v1/review_tasks/${taskId}/logs`)
    expect(http.requests[0]?.url.search).toBe('')
  })

  test('logs sends a zero tail, which is truthy in Ruby', async () => {
    const http = okHttp()
    const tail = 0n

    await new Client({ baseUrl, fetch: http.fetch }).logs({ taskId: 1, tail, afterId: false })

    expect(http.requests[0]?.url.searchParams.get('tail')).toBe(String(tail))
    expect(http.requests[0]?.url.searchParams.has('after_id')).toBe(false)
  })

  test('logs refuses a task id URI.join would reject, before sending anything', async () => {
    const http = okHttp()

    await expect(new Client({ baseUrl, fetch: http.fetch }).logs({ taskId: '1 x' })).rejects.toThrow(TypeError)
    expect(http.requests).toHaveLength(0)
  })

  test('switchRepo posts the payload', async () => {
    const http = okHttp()
    const repo = 'acme/api'

    await new Client({ baseUrl, fetch: http.fetch }).switchRepo({ repo })

    expect(http.requests[0]?.url.pathname).toBe('/api/v1/repositories/switch')
    expect(http.requests[0]?.body).toEqual({ repo })
  })

  test.each([baseUrl, `${baseUrl}/`])('builds the url from base %p', async (base) => {
    const http = okHttp()

    await new Client({ baseUrl: base, fetch: http.fetch }).status()

    expect(http.requests[0]?.url.href).toBe(`${baseUrl}/api/v1/status`)
  })

  test('keeps a path prefix on the base url', async () => {
    const http = okHttp()
    const prefixedBase = `${baseUrl}/forge`

    await new Client({ baseUrl: prefixedBase, fetch: http.fetch }).status()

    expect(http.requests[0]?.url.href).toBe(`${prefixedBase}/api/v1/status`)
  })

  test('returns an unknown api error when the body has no error details', async () => {
    const status = 500
    const http = fakeHttp(status, '{}')

    const failure = new Client({ baseUrl, fetch: http.fetch }).status()

    await expect(failure).rejects.toMatchObject({ code: 'unknown', message: 'Request failed', status })
  })

  test('treats a nil error like a missing one', async () => {
    const http = fakeHttp(422, JSON.stringify({ error: null }))

    await expect(new Client({ baseUrl, fetch: http.fetch }).status()).rejects.toMatchObject({ code: 'unknown' })
  })

  test('raises like Ruby when the error is not a hash', async () => {
    const http = fakeHttp(422, JSON.stringify({ error: 'boom' }))

    await expect(new Client({ baseUrl, fetch: http.fetch }).status()).rejects.toThrow(TypeError)
  })

  test('does not follow redirects, like Net::HTTP', async () => {
    const redirectStatus = 302
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (request) =>
        new URL(request.url).pathname === '/moved/api/v1/status'
          ? new Response(null, { status: redirectStatus, headers: { location: '/api/v1/status' } })
          : Response.json({ ok: true }),
    })

    try {
      const failure = new Client({ baseUrl: `http://127.0.0.1:${server.port}/moved` }).status()
      await expect(failure).rejects.toMatchObject({ status: redirectStatus, code: 'unknown' })
    } finally {
      await server.stop(true)
    }
  })

  describe('default base url', () => {
    const originalUrl = process.env.FORGE_API_URL

    beforeEach(() => {
      delete process.env.FORGE_API_URL
    })

    afterEach(() => {
      if (originalUrl === undefined) delete process.env.FORGE_API_URL
      else process.env.FORGE_API_URL = originalUrl
    })

    test('reads FORGE_API_URL, then falls back to the local server', async () => {
      const envUrl = 'http://forge.test:4000'
      const fallback = okHttp()
      const fromEnv = okHttp()

      await new Client({ fetch: fallback.fetch }).status()
      process.env.FORGE_API_URL = envUrl
      await new Client({ fetch: fromEnv.fetch }).status()

      expect(fallback.requests[0]?.url.href).toBe(`${DEFAULT_API_URL}/api/v1/status`)
      expect(fromEnv.requests[0]?.url.href).toBe(`${envUrl}/api/v1/status`)
    })
  })
})
