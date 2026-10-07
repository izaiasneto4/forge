import { describe, expect, test } from 'bun:test'
import { Elysia, t } from 'elysia'
import { ApiError, ERROR_CODES, errorHandling, ok } from '../../src/http/envelope'

const origin = 'http://localhost'

describe('error envelope', () => {
  const notFoundMessage = 'No local repository matched acme/api'
  const notFoundDetails = { paths: ['/repos/api'] }
  const notFoundStatus = 404
  const crashMessage = 'boom'
  const app = new Elysia()
    .use(errorHandling)
    .get('/raises', () => {
      throw new ApiError(ERROR_CODES.notFound, notFoundMessage, notFoundStatus, notFoundDetails)
    })
    .post('/validates', ({ body }) => ok(body), { body: t.Object({ repo: t.String() }) })
    // Typechecks as a number but fails TypeBox validation at runtime.
    .get('/breaks-contract', () => ok({ count: Number.parseInt(crashMessage, 10) }), {
      response: { 200: t.Object({ count: t.Number(), ok: t.Literal(true) }) },
    })
    .get('/crashes', () => {
      throw new Error(crashMessage)
    })

  async function call(path: string, init?: RequestInit) {
    const response = await app.handle(new Request(`${origin}${path}`, init))
    return { status: response.status, body: await response.json() }
  }

  test('renders ApiError with its code, status and details', async () => {
    const { status, body } = await call('/raises')

    expect(status).toBe(notFoundStatus)
    expect(body).toEqual({
      ok: false,
      error: { code: ERROR_CODES.notFound, message: notFoundMessage, details: notFoundDetails },
    })
  })

  test('renders invalid input as a 422 invalid_input error', async () => {
    const { status, body } = await call('/validates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(status).toBe(422)
    expect(body).toMatchObject({ ok: false, error: { code: ERROR_CODES.invalidInput } })
  })

  test('renders a response contract violation as a 500, not invalid input', async () => {
    const { status, body } = await call('/breaks-contract')

    expect(status).toBe(500)
    expect(body).toMatchObject({ ok: false, error: { code: ERROR_CODES.internal } })
  })

  test('hides unexpected error messages behind a 500', async () => {
    const { status, body } = await call('/crashes')

    expect(status).toBe(500)
    expect(body).toMatchObject({ ok: false, error: { code: ERROR_CODES.internal } })
    expect(JSON.stringify(body)).not.toContain(crashMessage)
  })
})
