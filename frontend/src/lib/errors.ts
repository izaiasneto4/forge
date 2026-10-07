import { ApiResponseError } from './api'

export function errorMessage(error: unknown) {
  if (error instanceof ApiResponseError) return error.error.message
  if (error instanceof Error) return error.message
  return 'Unknown error'
}
