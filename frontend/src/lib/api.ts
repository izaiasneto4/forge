import type { ApiError } from '../types/api'
import { apiBase, authHeaders, isDesktop } from './desktop'

type JsonBody = Record<string, unknown> | Array<unknown>

export class ApiResponseError extends Error {
  error: ApiError
  status: number

  constructor(error: ApiError, status: number) {
    super(error.message)
    this.name = 'ApiResponseError'
    this.error = error
    this.status = status
  }
}

function buildInit(method: string, body?: JsonBody | FormData): RequestInit {
  const headers = new Headers({
    Accept: 'application/json',
    ...authHeaders(),
  })

  // On desktop the API is another origin (and there are no cookies to send).
  const init: RequestInit = {
    method,
    credentials: isDesktop() ? 'omit' : 'same-origin',
    headers,
  }

  if (body instanceof FormData) {
    init.body = body
    return init
  }

  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
    init.body = JSON.stringify(body)
  }

  return init
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiBase() + path, init)
  const json = await response.json().catch(() => null)

  if (!response.ok || !json?.ok) {
    const error: ApiError = json?.error ?? {
      code: 'unknown_error',
      message: response.statusText || 'Request failed',
    }

    throw new ApiResponseError(error, response.status)
  }

  delete json.ok
  return json as T
}

export const api = {
  get<T>(path: string) {
    return request<T>(path, buildInit('GET'))
  },
  post<T>(path: string, body?: JsonBody | FormData) {
    return request<T>(path, buildInit('POST', body))
  },
  patch<T>(path: string, body?: JsonBody | FormData) {
    return request<T>(path, buildInit('PATCH', body))
  },
  delete<T>(path: string, body?: JsonBody) {
    return request<T>(path, buildInit('DELETE', body))
  },
}
