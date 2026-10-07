import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtimeConfig } from '../src/config'
import { STREAMS } from '../src/realtime/broadcaster'
import { CHANNELS } from '../src/realtime/ws-server'
import { startServer } from '../src/server'

function waitForFrame(frames: unknown[], match: (frame: unknown) => boolean, timeoutMs = 3000) {
  const existing = frames.find(match)
  if (existing !== undefined) return Promise.resolve(existing)

  return new Promise<unknown>((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const frame = frames.find(match)
      if (frame !== undefined) {
        clearInterval(timer)
        resolve(frame)
        return
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error('Timed out waiting for websocket frame'))
      }
    }, 10)
  })
}

describe('startServer', () => {
  let tempDir: string | undefined

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  })

  test('serves the API and shuts down promptly while a websocket client is connected', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ordem-server-'))
    const shutdownTimeoutMs = 3000
    const config = runtimeConfig({ PORT: '0', DATABASE_PATH: join(tempDir, 'ordem.sqlite3') })
    const server = startServer({ config, jobWorker: false, shutdownTimeoutMs })
    const origin = `http://localhost:${server.port}`

    const status = await fetch(`${origin}/api/v1/status`)
    const frames: unknown[] = []
    const client = new WebSocket(`ws://localhost:${server.port}/ws`, { headers: { origin } })
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

  test('delivers subscribed broadcasts over the real /ws socket', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ordem-server-'))
    const config = runtimeConfig({ PORT: '0', DATABASE_PATH: join(tempDir, 'ordem.sqlite3') })
    const server = startServer({ config, jobWorker: false })
    const origin = `http://localhost:${server.port}`
    const frames: unknown[] = []
    const message = { event: 'pull_request.updated', pull_request_id: 42 }

    const client = new WebSocket(`ws://localhost:${server.port}/ws`, { headers: { origin } })
    client.addEventListener('message', (event) => frames.push(JSON.parse(String(event.data))))
    await new Promise((resolve) => client.addEventListener('open', resolve, { once: true }))
    await waitForFrame(frames, (frame) => typeof frame === 'object' && frame !== null && 'type' in frame && frame.type === 'welcome')

    client.send(JSON.stringify({ type: 'subscribe', channel: CHANNELS.uiEvents }))
    await waitForFrame(
      frames,
      (frame) =>
        typeof frame === 'object' &&
        frame !== null &&
        'type' in frame &&
        frame.type === 'subscribed' &&
        'channel' in frame &&
        frame.channel === CHANNELS.uiEvents,
    )

    server.ctx.events.broadcast(STREAMS.uiEvents, message)
    await waitForFrame(
      frames,
      (frame) =>
        typeof frame === 'object' &&
        frame !== null &&
        'type' in frame &&
        frame.type === 'message' &&
        'channel' in frame &&
        frame.channel === CHANNELS.uiEvents &&
        'data' in frame &&
        JSON.stringify(frame.data) === JSON.stringify(message),
    )

    client.close()
    await server.stop()
  }, 15_000)
})
