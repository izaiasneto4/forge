import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { connect, isIP } from 'node:net'
import { Elysia } from 'elysia'
import { createApp } from '../../src/app'
import {
  ACTION_CABLE_PROTOCOL,
  cableServerWebSocketOptions,
  CLOSE_CODES,
  DEFAULT_CABLE_RELAY_LIMITS,
  railsCableProxy,
  upstreamCableHeaders,
  upstreamCableOrigin,
  type CableRelayLimits,
} from '../../src/http/rails-cable-proxy'
import { createTestDatabase } from '../support/database'

interface UpstreamConnection {
  origin: string | null
  host: string | null
}

const localOrigin = 'http://localhost:3100'
const echoPrefix = 'echo:'
const welcomeFrame = JSON.stringify({ type: 'welcome' })

// Bun 1.2.20: server.stop() never resolves once the server has closed a websocket
// itself, so stops are fired without awaiting.
function stopServer(server: { stop: (closeActiveConnections?: boolean) => unknown }) {
  void server.stop(true)
}

// Rails' development config.hosts: .localhost, .test and any IP address.
function isAllowedDevelopmentHost(hostWithPort: string) {
  const hostname = hostWithPort.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.test') || isIP(hostname) !== 0
}

// Mirrors Rails in development: HostAuthorization checks Host and X-Forwarded-Host,
// then ActionCable's allow_request_origin? compares Origin with the raw Host.
function startFakeRailsCable(options: { closeOnOpen?: { code: number; reason: string } } = {}) {
  return Bun.serve<UpstreamConnection>({
    port: 0,
    fetch(request, server) {
      const origin = request.headers.get('origin')
      const host = request.headers.get('host')
      const forwardedHost = request.headers.get('x-forwarded-host')?.split(/,\s?/).at(-1)
      if (!isAllowedDevelopmentHost(host ?? '') || (forwardedHost && !isAllowedDevelopmentHost(forwardedHost))) {
        return new Response('Blocked hosts', { status: 403 })
      }
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
  const relayLimits = { ...DEFAULT_CABLE_RELAY_LIMITS, ...limits }
  return new Elysia({ websocket: cableServerWebSocketOptions(relayLimits) })
    .use(railsCableProxy(railsUrl, relayLimits))
    .listen(0)
}

// Floods the relay without waiting for it, until the relay hangs up.
function startFloodingRailsCable(totalBytes: number) {
  const chunk = 'x'.repeat(256 * 1024)
  const closed = Promise.withResolvers<void>()
  let sentBytes = 0
  const server = Bun.serve({
    port: 0,
    fetch: (request, bunServer) => (bunServer.upgrade(request) ? undefined : new Response('Expected websocket', { status: 400 })),
    websocket: {
      backpressureLimit: totalBytes * 2,
      open(ws) {
        const timer = setInterval(() => {
          if (sentBytes >= totalBytes || ws.readyState !== WebSocket.OPEN) return clearInterval(timer)
          ws.send(chunk)
          sentBytes += chunk.length
        }, 1)
      },
      message() {},
      close() {
        closed.resolve()
      },
    },
  })
  return { server, closed: closed.promise }
}

// A browser that completes the handshake, then stops reading its socket.
function connectStalledBrowser(port: number) {
  const socket = connect(port, 'localhost', () => {
    socket.write(
      [
        'GET /cable HTTP/1.1',
        `Host: localhost:${port}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        `Sec-WebSocket-Protocol: ${ACTION_CABLE_PROTOCOL}`,
        `Origin: ${localOrigin}`,
        '',
        '',
      ].join('\r\n'),
    )
  })
  socket.once('data', () => socket.pause())
  return socket
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

describe('upstreamCableHeaders', () => {
  const railsUrl = 'http://127.0.0.1:3000'
  const host = 'forge.example.test'

  test("forwards the browser's host so Rails can still reject unknown hostnames", () => {
    const headers = upstreamCableHeaders({ origin: `http://${host}`, host, scheme: 'http' }, railsUrl)

    expect(headers).toEqual({ origin: new URL(railsUrl).origin, 'x-forwarded-host': host })
  })

  test('sends neither header when the browser sent neither', () => {
    expect(upstreamCableHeaders({ origin: undefined, host: undefined, scheme: 'http' }, railsUrl)).toEqual({})
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

  test("is rejected by Rails' host check for a DNS-rebound attacker hostname", async () => {
    const attackerHost = 'attacker.example:3100'

    const { frames } = await rawHandshake(appPort, {
      Host: attackerHost,
      Origin: `http://${attackerHost}`,
      'Sec-WebSocket-Protocol': ACTION_CABLE_PROTOCOL,
    })

    expect(frames).not.toContain(welcomeFrame)
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

  test('disconnects a browser that stops reading instead of buffering Rails frames without bound', async () => {
    const floodBytes = 12 * DEFAULT_CABLE_RELAY_LIMITS.maxBufferedBytes
    const floodingRails = startFloodingRailsCable(floodBytes)
    const relay = createApp({ db: createTestDatabase(), railsUrl: floodingRails.server.url.origin }).listen(0)
    servers.push(floodingRails.server, relay)
    const browser = connectStalledBrowser(relay.server?.port ?? 0)

    const outcome = await Promise.race([floodingRails.closed.then(() => 'relay hung up'), Bun.sleep(5000).then(() => 'still open')])

    browser.destroy()
    expect(outcome).toBe('relay hung up')
  }, 10_000)

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
