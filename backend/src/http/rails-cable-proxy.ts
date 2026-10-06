import { Elysia } from 'elysia'

// Bun echoes the client's subprotocol on upgrade, which the ActionCable JS client
// requires; setting the header ourselves would duplicate it.
export const ACTION_CABLE_PROTOCOL = 'actioncable-v1-json'

export const CLOSE_CODES = {
  upstreamFailed: 1011,
  overloaded: 1013,
} as const

export interface CableRelayLimits {
  handshakeTimeoutMs: number
  // Frames held while the Rails handshake is in progress.
  maxPendingBytes: number
  // Unsent bytes allowed in either direction before the relay gives up.
  maxBufferedBytes: number
}

export const DEFAULT_CABLE_RELAY_LIMITS: CableRelayLimits = {
  handshakeTimeoutMs: 10_000,
  maxPendingBytes: 1024 * 1024,
  maxBufferedBytes: 4 * 1024 * 1024,
}

interface CableRelay {
  upstream: WebSocket
  pendingFrames: string[]
  pendingBytes: number
  handshakeTimer: ReturnType<typeof setTimeout>
}

interface BrowserHandshake {
  origin: string | undefined
  host: string | undefined
  scheme: string
}

function cableUrlFor(railsUrl: string) {
  const url = new URL('/cable', railsUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function serializeFrame(message: unknown) {
  return typeof message === 'string' ? message : JSON.stringify(message)
}

// ActionCable accepts an Origin equal to "<scheme>://<raw Host header>", and the
// relay's upstream Host is the Rails address. So the relay runs that same-origin
// check against the browser's Host and vouches for passing requests with Rails'
// own origin. Other origins pass through unchanged for allowed_request_origins.
export function upstreamCableOrigin({ origin, host, scheme }: BrowserHandshake, railsUrl: string) {
  if (origin === undefined) return undefined
  return host !== undefined && origin === `${scheme}://${host}` ? new URL(railsUrl).origin : origin
}

function browserScheme(requestUrl: string, forwardedProto: string | undefined) {
  const proxiedScheme = forwardedProto?.split(',')[0]?.trim()
  return proxiedScheme || new URL(requestUrl).protocol.replace(':', '')
}

// Codes a server may send; reserved ones like 1006 (abnormal closure) map to 1011.
function clientCloseCode(upstreamCode: number) {
  const sendable =
    (upstreamCode >= 1000 && upstreamCode <= 1003) ||
    (upstreamCode >= 1007 && upstreamCode <= 1014) ||
    (upstreamCode >= 3000 && upstreamCode <= 4999)
  return sendable ? upstreamCode : CLOSE_CODES.upstreamFailed
}

// Relays /cable to Rails until ActionCable is ported.
export function railsCableProxy(railsUrl: string, limits: CableRelayLimits = DEFAULT_CABLE_RELAY_LIMITS) {
  const cableUrl = cableUrlFor(railsUrl)
  const relays = new Map<string, CableRelay>()

  return new Elysia({ name: 'rails-cable-proxy' }).ws('/cable', {
    backpressureLimit: limits.maxBufferedBytes,
    closeOnBackpressureLimit: true,
    open(ws) {
      const { origin, host } = ws.data.headers
      const scheme = browserScheme(ws.data.request.url, ws.data.headers['x-forwarded-proto'])
      const forwardedOrigin = upstreamCableOrigin({ origin, host, scheme }, railsUrl)
      const headers: Record<string, string> = forwardedOrigin === undefined ? {} : { origin: forwardedOrigin }

      const upstream = new WebSocket(cableUrl, { protocols: [ACTION_CABLE_PROTOCOL], headers })
      const handshakeTimer = setTimeout(
        () => ws.close(CLOSE_CODES.upstreamFailed, 'Rails cable handshake timed out'),
        limits.handshakeTimeoutMs,
      )
      const relay: CableRelay = { upstream, pendingFrames: [], pendingBytes: 0, handshakeTimer }
      relays.set(ws.id, relay)

      upstream.addEventListener('open', () => {
        clearTimeout(relay.handshakeTimer)
        for (const frame of relay.pendingFrames.splice(0)) upstream.send(frame)
        relay.pendingBytes = 0
      })
      upstream.addEventListener('message', (event) => ws.send(event.data))
      upstream.addEventListener('close', (event) => ws.close(clientCloseCode(event.code), event.reason))
    },
    message(ws, message) {
      const relay = relays.get(ws.id)
      if (!relay) return

      const frame = serializeFrame(message)
      const frameBytes = Buffer.byteLength(frame)
      if (relay.upstream.readyState === WebSocket.OPEN) {
        if (relay.upstream.bufferedAmount + frameBytes > limits.maxBufferedBytes) {
          ws.close(CLOSE_CODES.overloaded, 'Rails cable is not keeping up')
          return
        }
        relay.upstream.send(frame)
        return
      }

      relay.pendingBytes += frameBytes
      if (relay.pendingBytes > limits.maxPendingBytes) {
        ws.close(CLOSE_CODES.overloaded, 'Too much data before Rails cable connected')
        return
      }
      relay.pendingFrames.push(frame)
    },
    close(ws) {
      const relay = relays.get(ws.id)
      if (!relay) return

      clearTimeout(relay.handshakeTimer)
      relay.upstream.close()
      relays.delete(ws.id)
    },
  })
}
