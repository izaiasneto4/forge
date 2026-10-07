import { fileURLToPath } from 'node:url'
import { type CliOptions, type Sleep, start } from '../../src/cli/cli'
import type { ForgeApi, ListParams, LogsParams, ReviewParams } from '../../src/cli/client'

export const FORGE_BIN = fileURLToPath(new URL('../../bin/forge.ts', import.meta.url))

export class StringWriter {
  text = ''

  write(chunk: string) {
    this.text += chunk
  }
}

type ApiMethod = keyof ForgeApi

export interface ScriptedAnswer {
  result?: unknown
  error?: unknown
}

export interface RecordedCall {
  method: ApiMethod
  params: unknown
}

// Plays back answers in order and records every call, like the mocha client mocks in the Ruby tests.
export class ScriptedClient implements ForgeApi {
  readonly calls: RecordedCall[] = []

  constructor(private readonly answers: ScriptedAnswer[] = []) {}

  get unansweredCount() {
    return this.answers.length
  }

  sync(params?: { force?: boolean }) {
    return this.answer('sync', params)
  }

  review(params: ReviewParams) {
    return this.answer('review', params)
  }

  status() {
    return this.answer('status', undefined)
  }

  list(params?: ListParams) {
    return this.answer('list', params)
  }

  logs(params: LogsParams) {
    return this.answer('logs', params)
  }

  switchRepo(params: { repo: string }) {
    return this.answer('switchRepo', params)
  }

  private async answer(method: ApiMethod, params: unknown) {
    this.calls.push({ method, params })
    const answer = this.answers.shift()
    if (answer === undefined) throw new Error(`unexpected ${method} call`)
    if (answer.error !== undefined) throw answer.error
    return answer.result
  }
}

export interface RunCliOptions {
  client?: ScriptedClient
  sleep?: Sleep
  env?: CliOptions['env']
  createClient?: CliOptions['createClient']
}

export const TEST_API_URL = 'http://example.test'

export async function runCli(argv: string[], options: RunCliOptions = {}) {
  const client = options.client ?? new ScriptedClient()
  const stdout = new StringWriter()
  const stderr = new StringWriter()
  const code = await start(argv, {
    stdout,
    stderr,
    env: options.env ?? { FORGE_API_URL: TEST_API_URL },
    sleep: options.sleep ?? (() => {}),
    createClient: options.createClient ?? (() => client),
  })
  return { code, stdout: stdout.text, stderr: stderr.text, client }
}

export type StubHandler = (request: Request) => Promise<[number, unknown]> | [number, unknown]

export async function withStubServer(handler: StubHandler, run: (baseUrl: string) => Promise<void>) {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const [status, payload] = await handler(request)
      return Response.json(payload, { status })
    },
  })

  try {
    await run(`http://127.0.0.1:${server.port}`)
  } finally {
    await server.stop(true)
  }
}

// A URL nothing listens on, like the Ruby test's freshly closed TCPServer port.
export async function closedPortUrl() {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
  const port = server.port
  await server.stop(true)
  return { url: `http://127.0.0.1:${port}`, port }
}

export function spawnBin(argv: string[], baseUrl: string) {
  return Bun.spawn([FORGE_BIN, ...argv], {
    env: { ...process.env, FORGE_API_URL: baseUrl, POSIXLY_CORRECT: undefined },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

export async function runBin(argv: string[], baseUrl: string) {
  const child = spawnBin(argv, baseUrl)
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

export async function readJson(request: Request): Promise<unknown> {
  const body = await request.text()
  return body.trim() === '' ? {} : JSON.parse(body)
}
