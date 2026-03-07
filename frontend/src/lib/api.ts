import type { ApiError } from '../types/api'

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
  })

  const init: RequestInit = {
    method,
    credentials: 'same-origin',
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
  const response = await fetch(path, init)
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
