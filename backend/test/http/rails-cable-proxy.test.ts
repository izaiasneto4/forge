import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { createApp } from '../../src/app'
import {
  ACTION_CABLE_PROTOCOL,
  CLOSE_CODES,
  DEFAULT_CABLE_RELAY_LIMITS,
  railsCableProxy,
  upstreamCableOrigin,
  type CableRelayLimits,
} from '../../src/http/rails-cable-proxy'
import { createTestDatabase } from '../support/database'

interface UpstreamConnection {
  origin: string | null
  host: string | null
}

const localOrigin = 'http://localhost:3100'

// Bun 1.2.20: server.stop() never resolves once the server has closed a websocket
// itself, so stops are fired without awaiting.
function stopServer(server: { stop: (closeActiveConnections?: boolean) => unknown }) {
  void server.stop(true)
}
const echoPrefix = 'echo:'
const welcomeFrame = JSON.stringify({ type: 'welcome' })

// Mirrors ActionCable::Connection::Base#allow_request_origin? with
// allow_same_origin_as_host and no allowed_request_origins.
function startFakeRailsCable(options: { closeOnOpen?: { code: number; reason: string } } = {}) {
  return Bun.serve<UpstreamConnection>({
    port: 0,
    fetch(request, server) {
      const origin = request.headers.get('origin')
      const host = request.headers.get('host')
      if (origin !== `http://${host}` && origin !== localOrigin) {
        return new Response('Request origin not allowed', { status: 404 })
      }

      const upgraded = server.upgrade(request, { data: { origin, host } })
      return upgraded ? undefined : new Response('Expected websocket', { status: 400 })
    },
    websocket: {
      open(ws) {
        if (options.closeOnOpen) {
          ws.close(options.closeOnOpen.code, options.closeOnOpen.reason)
          return
        }
        ws.send(welcomeFrame)
      },
      message(ws, message) {
        ws.send(`${echoPrefix}${message}`)
      },
    },
  })
}

// Accepts TCP connections but never answers the websocket handshake.
function startStalledUpstream() {
  return Bun.listen({ hostname: 'localhost', port: 0, socket: { data() {} } })
}

function listenRelay(railsUrl: string, limits: Partial<CableRelayLimits> = {}) {
  return new Elysia().use(railsCableProxy(railsUrl, { ...DEFAULT_CABLE_RELAY_LIMITS, ...limits })).listen(0)
}

function connectBrowser(port: number) {
  return new WebSocket(`ws://localhost:${port}/cable`, { protocols: [ACTION_CABLE_PROTOCOL], headers: { origin: localOrigin } })
}

function nextMessage(socket: WebSocket) {
  return new Promise<string>((resolve) => {
    socket.addEventListener('message', (event) => resolve(String(event.data)), { once: true })
  })
}

function closeEvent(socket: WebSocket) {
  return new Promise<{ code: number; reason: string }>((resolve) => {
    socket.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason }), { once: true })
  })
}

// Raw handshake, since WebSocket clients can't set Host or read handshake headers.
async function rawHandshake(port: number, headers: Record<string, string>, readForMs = 500) {
  const request = [
    'GET /cable HTTP/1.1',
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Version: 13',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    '',
    '',
  ].join('\r\n')

  let received = ''
  const socket = await Bun.connect({
    hostname: 'localhost',
    port,
    socket: {
      open(connection) {
        connection.write(request)
      },
      data(_connection, chunk) {
        received += chunk.toString()
      },
    },
  })
  await Bun.sleep(readForMs)
  socket.end()

  const [head = '', ...frames] = received.split('\r\n\r\n')
  return { headerLines: head.split('\r\n'), frames: frames.join('\r\n\r\n') }
}

describe('upstreamCableOrigin', () => {
  const railsUrl = 'http://127.0.0.1:3000'
  const railsOrigin = new URL(railsUrl).origin
  const host = 'forge.example.test'

  test('vouches for same-origin browsers with the Rails origin', () => {
    expect(upstreamCableOrigin({ origin: `http://${host}`, host, scheme: 'http' }, railsUrl)).toBe(railsOrigin)
  })

  test('respects the scheme the browser actually used', () => {
    const httpsOrigin = `https://${host}`

    expect(upstreamCableOrigin({ origin: httpsOrigin, host, scheme: 'https' }, railsUrl)).toBe(railsOrigin)
    expect(upstreamCableOrigin({ origin: httpsOrigin, host, scheme: 'http' }, railsUrl)).toBe(httpsOrigin)
  })

  test('passes cross-origin values through for Rails to judge', () => {
    const crossOrigin = 'https://evil.example'

    expect(upstreamCableOrigin({ origin: crossOrigin, host, scheme: 'https' }, railsUrl)).toBe(crossOrigin)
  })

  test('sends no origin when the browser sent none', () => {
    expect(upstreamCableOrigin({ origin: undefined, host, scheme: 'http' }, railsUrl)).toBeUndefined()
  })
})

describe('rails cable relay', () => {
  let fakeRails: ReturnType<typeof startFakeRailsCable>
  let app: ReturnType<typeof createApp>
  let appPort: number

  beforeAll(() => {
    fakeRails = startFakeRailsCable()
    app = createApp({ db: createTestDatabase(), railsUrl: fakeRails.url.origin }).listen(0)
    appPort = app.server?.port ?? 0
  })

  afterAll(() => {
    stopServer(app)
    stopServer(fakeRails)
  })

  test('agrees to the ActionCable subprotocol exactly once, as browsers require', async () => {
    const browserOfferedProtocols = `${ACTION_CABLE_PROTOCOL}, actioncable-unsupported`

    const { headerLines } = await rawHandshake(appPort, {
      Host: `localhost:${appPort}`,
      Origin: localOrigin,
      'Sec-WebSocket-Protocol': browserOfferedProtocols,
    })
    const protocolHeaders = headerLines.filter((line) => line.toLowerCase().startsWith('sec-websocket-protocol:'))

    expect(headerLines[0]).toContain('101')
    expect(protocolHeaders).toEqual([`Sec-WebSocket-Protocol: ${ACTION_CABLE_PROTOCOL}`])
  })

  test('relays frames both ways', async () => {
    const outgoingFrame = JSON.stringify({ command: 'subscribe', identifier: '{"channel":"UiEventsChannel"}' })
    const client = connectBrowser(appPort)

    const welcome = await nextMessage(client)
    const echoed = nextMessage(client)
    client.send(outgoingFrame)

    expect(welcome).toBe(welcomeFrame)
    expect(await echoed).toBe(`${echoPrefix}${outgoingFrame}`)
    client.close()
  })

  test('is accepted by Rails for a same-origin browser on a public host', async () => {
    const publicHost = 'forge.example.test'

    const { frames } = await rawHandshake(appPort, {
      Host: publicHost,
      Origin: `https://${publicHost}`,
      'X-Forwarded-Proto': 'https',
      'Sec-WebSocket-Protocol': ACTION_CABLE_PROTOCOL,
    })

    expect(frames).toContain(welcomeFrame)
  })

  test('is still rejected by Rails for a cross-origin browser', async () => {
    const publicHost = 'forge.example.test'

    const { frames } = await rawHandshake(appPort, {
      Host: publicHost,
      Origin: 'https://evil.example',
      'Sec-WebSocket-Protocol': ACTION_CABLE_PROTOCOL,
    })

    expect(frames).not.toContain(welcomeFrame)
  })
})

describe('rails cable relay failure handling', () => {
  const servers: Array<{ stop: (closeActiveConnections?: boolean) => unknown }> = []

  afterEach(() => {
    for (const server of servers.splice(0)) stopServer(server)
  })

  test('passes the Rails close code and reason through to the browser', async () => {
    const railsClose = { code: 4001, reason: 'unauthorized' }
    const fakeRails = startFakeRailsCable({ closeOnOpen: railsClose })
    const relay = listenRelay(fakeRails.url.origin)
    servers.push(fakeRails, relay)

    const closed = await closeEvent(connectBrowser(relay.server?.port ?? 0))

    expect(closed).toEqual(railsClose)
  })

  test('closes the browser socket when Rails is unreachable', async () => {
    const unreachableRailsUrl = 'http://127.0.0.1:1'
    const relay = listenRelay(unreachableRailsUrl)
    servers.push(relay)

    const closed = await closeEvent(connectBrowser(relay.server?.port ?? 0))

    expect(closed.code).toBe(CLOSE_CODES.upstreamFailed)
  })

  test('gives up when the Rails handshake stalls', async () => {
    const stalled = startStalledUpstream()
    const relay = listenRelay(`http://localhost:${stalled.port}`, { handshakeTimeoutMs: 200 })
    servers.push(stalled, relay)

    const closed = await closeEvent(connectBrowser(relay.server?.port ?? 0))

    expect(closed.code).toBe(CLOSE_CODES.upstreamFailed)
  })

  test('closes instead of buffering without bound while Rails is connecting', async () => {
    const maxPendingBytes = 1024
    const stalled = startStalledUpstream()
    const relay = listenRelay(`http://localhost:${stalled.port}`, { maxPendingBytes })
    servers.push(stalled, relay)
    const client = connectBrowser(relay.server?.port ?? 0)
    const closed = closeEvent(client)

    await new Promise((resolve) => client.addEventListener('open', resolve, { once: true }))
    client.send('x'.repeat(maxPendingBytes + 1))

    expect((await closed).code).toBe(CLOSE_CODES.overloaded)
  })
})
