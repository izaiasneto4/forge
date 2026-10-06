import { Elysia } from 'elysia'

// Bun echoes the client's subprotocol on upgrade, which the ActionCable JS client
// requires; setting the header ourselves would duplicate it.
export const ACTION_CABLE_PROTOCOL = 'actioncable-v1-json'

interface CableRelay {
  upstream: WebSocket
  pendingFrames: string[]
}

function cableUrlFor(railsUrl: string) {
  const url = new URL('/cable', railsUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function serializeFrame(message: unknown) {
  return typeof message === 'string' ? message : JSON.stringify(message)
}

// Relays /cable to Rails until ActionCable is ported. Forwarding the browser's
// Origin plus X-Forwarded-Host keeps Rails' same-origin check meaningful.
export function railsCableProxy(railsUrl: string) {
  const cableUrl = cableUrlFor(railsUrl)
  const relays = new Map<string, CableRelay>()

  return new Elysia({ name: 'rails-cable-proxy' }).ws('/cable', {
    open(ws) {
      const forwardedHeaders: Record<string, string> = {}
      const { origin, host } = ws.data.headers
      if (origin) forwardedHeaders.origin = origin
      if (host) forwardedHeaders['x-forwarded-host'] = host

      const upstream = new WebSocket(cableUrl, { protocols: [ACTION_CABLE_PROTOCOL], headers: forwardedHeaders })
      const relay: CableRelay = { upstream, pendingFrames: [] }
      relays.set(ws.id, relay)

      upstream.addEventListener('open', () => {
        for (const frame of relay.pendingFrames.splice(0)) upstream.send(frame)
      })
      upstream.addEventListener('message', (event) => ws.send(event.data))
      upstream.addEventListener('close', () => ws.close())
      upstream.addEventListener('error', () => ws.close())
    },
    message(ws, message) {
      const relay = relays.get(ws.id)
      if (!relay) return

      const frame = serializeFrame(message)
      if (relay.upstream.readyState === WebSocket.OPEN) {
        relay.upstream.send(frame)
      } else {
        relay.pendingFrames.push(frame)
      }
    },
    close(ws) {
      relays.get(ws.id)?.upstream.close()
      relays.delete(ws.id)
    },
  })
}
