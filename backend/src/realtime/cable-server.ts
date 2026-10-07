import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { reviewTasks } from '../db/schema'
import { STREAMS, type BroadcastMessage, type Broadcaster } from './broadcaster'

// Native ActionCable server: speaks the `actioncable-v1-json` protocol the
// React app's @rails/actioncable consumer expects.
export const PING_INTERVAL_MS = 3000

interface CableConnection {
  send(frame: string): void
  // Subscription identifier (as sent by the client) -> streams it listens to.
  subscriptions: Map<string, string[]>
}

type ChannelParams = Record<string, unknown>

// Each channel's `subscribed` hook: the streams to follow, or null to refuse.
type ChannelResolver = (params: ChannelParams, db: Db) => string[] | null

function integerParam(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number.parseInt(value, 10)
  return null
}

export const CHANNELS: Record<string, ChannelResolver> = {
  ReviewNotificationsChannel: () => [STREAMS.reviewNotifications],
  UiEventsChannel: () => [STREAMS.uiEvents],
  // ReviewTask.find(params[:review_task_id]); a missing task never confirms.
  ReviewTaskLogsChannel: (params, db) => {
    const id = integerParam(params.review_task_id)
    if (id === null) return null
    const task = db.select({ id: reviewTasks.id }).from(reviewTasks).where(eq(reviewTasks.id, id)).get()
    return task ? [STREAMS.reviewTaskLogs(task.id)] : null
  },
}

function parseIdentifier(identifier: string): { channel: string; params: ChannelParams } | null {
  try {
    const parsed: unknown = JSON.parse(identifier)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const params: ChannelParams = { ...parsed }
    const channel = params.channel
    if (typeof channel !== 'string') return null
    return { channel, params }
  } catch {
    return null
  }
}

function parseCommand(frame: unknown): { command: string; identifier: string } | null {
  const value: unknown = typeof frame === 'string' ? safeJson(frame) : frame
  if (typeof value !== 'object' || value === null) return null
  const command = 'command' in value ? value.command : undefined
  const identifier = 'identifier' in value ? value.identifier : undefined
  if (typeof command !== 'string' || typeof identifier !== 'string') return null
  return { command, identifier }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export class CableServer implements Broadcaster {
  private readonly connections = new Map<string, CableConnection>()
  private pingTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly db: Db) {}

  broadcast(stream: string, message: BroadcastMessage) {
    for (const connection of this.connections.values()) {
      for (const [identifier, streams] of connection.subscriptions) {
        if (streams.includes(stream)) connection.send(JSON.stringify({ identifier, message }))
      }
    }
  }

  connectionCount() {
    return this.connections.size
  }

  open(id: string, send: (frame: string) => void) {
    this.connections.set(id, { send, subscriptions: new Map() })
    send(JSON.stringify({ type: 'welcome' }))
    this.startPinging()
  }

  receive(id: string, frame: unknown) {
    const connection = this.connections.get(id)
    const command = parseCommand(frame)
    if (!connection || !command) return

    if (command.command === 'subscribe') this.subscribe(connection, command.identifier)
    else if (command.command === 'unsubscribe') connection.subscriptions.delete(command.identifier)
  }

  close(id: string) {
    this.connections.delete(id)
    if (this.connections.size === 0) this.stopPinging()
  }

  stop() {
    this.stopPinging()
    this.connections.clear()
  }

  private subscribe(connection: CableConnection, identifier: string) {
    if (connection.subscriptions.has(identifier)) return
    const parsed = parseIdentifier(identifier)
    const resolver = parsed ? CHANNELS[parsed.channel] : undefined
    if (!parsed || !resolver) return

    const streams = resolver(parsed.params, this.db)
    if (streams === null) return
    connection.subscriptions.set(identifier, streams)
    connection.send(JSON.stringify({ identifier, type: 'confirm_subscription' }))
  }

  private startPinging() {
    if (this.pingTimer) return
    this.pingTimer = setInterval(() => {
      const frame = JSON.stringify({ type: 'ping', message: Math.floor(Date.now() / 1000) })
      for (const connection of this.connections.values()) connection.send(frame)
    }, PING_INTERVAL_MS)
  }

  private stopPinging() {
    clearInterval(this.pingTimer)
    this.pingTimer = undefined
  }
}

export interface CableLimits {
  maxBufferedBytes: number
}

export const DEFAULT_CABLE_LIMITS: CableLimits = { maxBufferedBytes: 4 * 1024 * 1024 }

// Bun reads backpressure settings per server, not per route, so the app that
// mounts the cable must pass these to `new Elysia({ websocket })`.
export function cableServerWebSocketOptions(limits: CableLimits = DEFAULT_CABLE_LIMITS) {
  return { backpressureLimit: limits.maxBufferedBytes, closeOnBackpressureLimit: true }
}

// Mounts the cable at /cable. `isAllowedOrigin` mirrors ActionCable's
// allow_request_origin?; refused handshakes get a 404 like Rails.
export function cablePlugin(server: CableServer, isAllowedOrigin: (request: Request) => boolean) {
  return new Elysia({ name: 'cable' }).ws('/cable', {
    beforeHandle({ request, set }) {
      if (isAllowedOrigin(request)) return undefined
      set.status = 404
      return 'Request origin not allowed'
    },
    open(ws) {
      server.open(ws.id, (frame) => {
        ws.send(frame)
      })
    },
    message(ws, message) {
      server.receive(ws.id, message)
    },
    close(ws) {
      server.close(ws.id)
    },
  })
}
