import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createApp } from '../../src/app'
import { ACTION_CABLE_PROTOCOL } from '../../src/http/rails-cable-proxy'
import { createTestDatabase } from '../support/database'

interface UpstreamConnection {
  origin: string | null
  forwardedHost: string | null
}

const browserOrigin = 'http://localhost:3100'
const echoPrefix = 'echo:'

function startFakeRailsCable() {
  return Bun.serve<UpstreamConnection>({
    port: 0,
    fetch(request, server) {
      const upgraded = server.upgrade(request, {
        data: { origin: request.headers.get('origin'), forwardedHost: request.headers.get('x-forwarded-host') },
      })
      return upgraded ? undefined : new Response('Expected websocket', { status: 400 })
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ type: 'welcome', ...ws.data }))
      },
      message(ws, message) {
        ws.send(`${echoPrefix}${message}`)
      },
    },
  })
}

function nextMessage(socket: WebSocket) {
  return new Promise<string>((resolve) => {
    socket.addEventListener('message', (event) => resolve(String(event.data)), { once: true })
  })
}

// Reads the raw 101 response, since WebSocket clients hide handshake headers.
async function rawHandshakeHeaders(port: number, offeredProtocols: string) {
  const request = [
    'GET /cable HTTP/1.1',
    `Host: localhost:${port}`,
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Version: 13',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    `Sec-WebSocket-Protocol: ${offeredProtocols}`,
    `Origin: ${browserOrigin}`,
    '',
    '',
  ].join('\r\n')

  const response = await new Promise<string>((resolve) => {
    let received = ''
    Bun.connect({
      hostname: 'localhost',
      port,
      socket: {
        open(socket) {
          socket.write(request)
        },
        data(socket, chunk) {
          received += chunk.toString()
          if (received.includes('\r\n\r\n')) {
            socket.end()
            resolve(received.split('\r\n\r\n')[0] ?? '')
          }
        },
      },
    })
  })

  return response.split('\r\n')
}

describe('rails cable relay', () => {
  let fakeRails: ReturnType<typeof startFakeRailsCable>
  let app: ReturnType<typeof createApp>
  let appPort: number

  beforeAll(() => {
    fakeRails = startFakeRailsCable()
    app = createApp({ db: createTestDatabase(), railsUrl: fakeRails.url.origin }).listen(0)
    appPort = app.server?.port ?? 0
  })

  afterAll(async () => {
    await app.stop(true)
    fakeRails.stop(true)
  })

  test('agrees to the ActionCable subprotocol exactly once, as browsers require', async () => {
    const browserOfferedProtocols = `${ACTION_CABLE_PROTOCOL}, actioncable-unsupported`

    const headers = await rawHandshakeHeaders(appPort, browserOfferedProtocols)
    const protocolHeaders = headers.filter((header) => header.toLowerCase().startsWith('sec-websocket-protocol:'))

    expect(headers[0]).toContain('101')
    expect(protocolHeaders).toEqual([`Sec-WebSocket-Protocol: ${ACTION_CABLE_PROTOCOL}`])
  })

  test('relays frames both ways and forwards origin and host to Rails', async () => {
    const outgoingFrame = JSON.stringify({ command: 'subscribe', identifier: '{"channel":"UiEventsChannel"}' })
    const client = new WebSocket(`ws://localhost:${appPort}/cable`, {
      protocols: [ACTION_CABLE_PROTOCOL],
      headers: { origin: browserOrigin },
    })

    const welcome = JSON.parse(await nextMessage(client))
    const echoed = nextMessage(client)
    client.send(outgoingFrame)

    expect(welcome).toEqual({ type: 'welcome', origin: browserOrigin, forwardedHost: `localhost:${appPort}` })
    expect(await echoed).toBe(`${echoPrefix}${outgoingFrame}`)
    client.close()
  })
})
