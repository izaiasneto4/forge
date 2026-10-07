import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtimeConfig } from '../src/config'
import { startServer } from '../src/server'

describe('startServer', () => {
  let tempDir: string | undefined

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  })

  test('serves the API and shuts down promptly while a cable client is connected', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ordem-server-'))
    const shutdownTimeoutMs = 3000
    const config = runtimeConfig({ PORT: '0', DATABASE_PATH: join(tempDir, 'ordem.sqlite3') })
    const server = startServer({ config, jobWorker: false, shutdownTimeoutMs })
    const origin = `http://localhost:${server.port}`

    const status = await fetch(`${origin}/api/v1/status`)
    const frames: unknown[] = []
    const client = new WebSocket(`ws://localhost:${server.port}/cable`, { protocols: ['actioncable-v1-json'], headers: { origin } })
    const closed = new Promise<string>((resolve) => client.addEventListener('close', (event) => resolve(event.reason)))
    client.addEventListener('message', (event) => frames.push(JSON.parse(String(event.data))))
    await new Promise((resolve) => client.addEventListener('open', resolve, { once: true }))

    const started = performance.now()
    await server.stop()
    const elapsed = performance.now() - started

    expect(status.status).toBe(200)
    expect(await closed).toBe('server_restart')
    expect(frames).toContainEqual({ type: 'disconnect', reason: 'server_restart', reconnect: true })
    expect(elapsed).toBeLessThan(shutdownTimeoutMs * 2 + 1000)
  }, 15_000)
})
