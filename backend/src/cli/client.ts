import { type JsonObject, rubyIndex, rubyToS, rubyTruthy } from './formatter'

// Port of the original Ruby client: a thin JSON client for /api/v1.

export const DEFAULT_API_URL = 'http://127.0.0.1:3000'

// What Net::HTTP reports when the server accepts the connection but doesn't answer in time.
const READ_TIMEOUT_MESSAGE = 'Net::ReadTimeout with #<TCPSocket:(closed)>'

// RFC 3986 relative reference: what URI.join accepts before WHATWG URL would percent-encode the rest.
const URI_CHARACTER = String.raw`(?:[\w\-.~!$&'()*+,;=:@/?]|%[\da-f]{2})`
const URI_REFERENCE = new RegExp(`^${URI_CHARACTER}*(?:#${URI_CHARACTER}*)?$`, 'i')

export class ClientError extends Error {}

export class ConnectionError extends ClientError {}

export class ApiError extends ClientError {
  constructor(
    message: string,
    readonly code: unknown,
    readonly status: number,
  ) {
    super(message)
  }
}

// Ruby's Interrupt: Ctrl-C landing while a request or a sleep is in flight.
export class Interrupt extends Error {}

export type FetchFunction = (url: URL, init: RequestInit) => Promise<Response>

export interface ClientOptions {
  baseUrl?: string
  timeoutSeconds?: number
  signal?: AbortSignal
  fetch?: FetchFunction
}

export interface ReviewParams {
  prUrl: string
  cliClient?: string | null
  reviewType?: string | null
}

export interface ListParams {
  status?: string | null
  limit?: bigint | number | null
}

export interface LogsParams {
  taskId: string | number
  tail?: bigint | number | null
  afterId?: unknown
}

export interface OrdemApi {
  sync(params?: { force?: boolean }): Promise<unknown>
  review(params: ReviewParams): Promise<unknown>
  status(): Promise<unknown>
  list(params?: ListParams): Promise<unknown>
  logs(params: LogsParams): Promise<unknown>
  switchRepo(params: { repo: string }): Promise<unknown>
}

type Query = [string, string][]

export class Client implements OrdemApi {
  private readonly baseUrl: string
  private readonly timeoutSeconds: number
  private readonly interrupt: AbortSignal | undefined
  private readonly fetch: FetchFunction

  constructor({
    baseUrl = process.env.ORDEM_API_URL ?? DEFAULT_API_URL,
    timeoutSeconds = 10,
    signal,
    fetch: fetchFunction = (url, init) => fetch(url, init),
  }: ClientOptions = {}) {
    this.baseUrl = baseUrl
    this.timeoutSeconds = timeoutSeconds
    this.interrupt = signal
    this.fetch = fetchFunction
  }

  sync({ force = false }: { force?: boolean } = {}) {
    return this.postJson('/api/v1/sync', { force })
  }

  review({ prUrl, cliClient, reviewType }: ReviewParams) {
    const payload: JsonObject = { pr_url: prUrl }
    if (rubyTruthy(cliClient)) payload.cli_client = cliClient
    if (rubyTruthy(reviewType)) payload.review_type = reviewType
    return this.postJson('/api/v1/reviews', payload)
  }

  status() {
    return this.getJson('/api/v1/status')
  }

  list({ status, limit }: ListParams = {}) {
    const query: Query = []
    if (rubyTruthy(status)) query.push(['status', rubyToS(status)])
    if (rubyTruthy(limit)) query.push(['limit', rubyToS(limit)])
    return this.getJson('/api/v1/pull_requests', query)
  }

  logs({ taskId, tail, afterId }: LogsParams) {
    const query: Query = []
    if (rubyTruthy(tail)) query.push(['tail', rubyToS(tail)])
    if (rubyTruthy(afterId)) query.push(['after_id', rubyToS(afterId)])
    return this.getJson(`/api/v1/review_tasks/${taskId}/logs`, query)
  }

  switchRepo({ repo }: { repo: string }) {
    return this.postJson('/api/v1/repositories/switch', { repo })
  }

  private async getJson(path: string, query: Query = []) {
    return this.perform(this.buildUrl(path, query), { method: 'GET' })
  }

  private async postJson(path: string, payload: JsonObject) {
    return this.perform(this.buildUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  private async perform(url: URL, init: RequestInit) {
    const { status, body } = await this.send(url, init)
    const parsed = parseBody(body)
    if (status >= 200 && status <= 299) return parsed

    const code = errorField(parsed, 'code')
    const message = errorField(parsed, 'message')
    throw new ApiError(
      rubyTruthy(message) ? rubyToS(message) : 'Request failed',
      rubyTruthy(code) ? code : 'unknown',
      status,
    )
  }

  private async send(url: URL, init: RequestInit) {
    const timeout = AbortSignal.timeout(this.timeoutSeconds * 1000)
    const signal = this.interrupt ? AbortSignal.any([timeout, this.interrupt]) : timeout

    try {
      // Net::HTTP never follows redirects; a 3xx is just another non-2xx answer.
      const response = await this.fetch(url, { ...init, signal, redirect: 'manual' })
      return { status: response.status, body: await response.text() }
    } catch (error) {
      if (this.interrupt?.aborted) throw new Interrupt()
      if (timeout.aborted) throw new ConnectionError(READ_TIMEOUT_MESSAGE)
      if (isConnectionRefused(error)) throw new ConnectionError(connectionRefusedMessage(url))
      throw error
    }
  }

  // URI.join(base + "/", path without its leading slash), so base paths are kept.
  private buildUrl(path: string, query: Query = []) {
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`
    const relative = path.replace(/^\//, '')
    // Ruby raises URI::InvalidURIError here (e.g. a task id with a space) instead of sending anything.
    if (!URI_REFERENCE.test(relative)) throw new TypeError(`bad URI (is not URI?): ${JSON.stringify(relative)}`)

    const url = new URL(relative, base)
    if (query.length > 0) url.search = new URLSearchParams(query).toString()
    return url
  }
}

function parseBody(body: string): unknown {
  if (body.trim() === '') return {}

  try {
    return JSON.parse(body)
  } catch {
    return {}
  }
}

// parsed.dig("error", field): stops at nil, raises on non-Hash receivers like Ruby.
function errorField(parsed: unknown, field: string) {
  const error = rubyIndex(parsed, 'error')
  return error === null ? null : rubyIndex(error, field)
}

// Bun reports refused connections and unresolvable hosts alike as ConnectionRefused.
function isConnectionRefused(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ConnectionRefused'
}

function connectionRefusedMessage(url: URL) {
  const host = url.hostname
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  return `Failed to open TCP connection to ${host}:${port} (Connection refused - connect(2) for "${host}" port ${port})`
}
