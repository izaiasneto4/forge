import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { reviewTasks } from '../db/schema'
import { STREAMS, type BroadcastMessage, type Broadcaster } from './broadcaster'

export const PING_INTERVAL_MS = 3000
export const WS_PATH = '/ws'
const GOING_AWAY = 1001

export const CHANNELS = Object.freeze({
  uiEvents: 'ui_events',
  reviewNotifications: 'review_notifications',
  reviewTaskLogs: 'review_task_logs',
})

interface WsConnection {
  send(frame: string): void
  close(code: number, reason: string): void
  subscriptions: Map<string, string[]>
}

type ClientMessage =
  | { type: 'subscribe'; channel: string; review_task_id?: unknown }
  | { type: 'unsubscribe'; channel: string; review_task_id?: unknown }

function integerParam(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number.parseInt(value, 10)
  return null
}

function subscriptionKey(channel: string, reviewTaskId: number | null) {
  return reviewTaskId === null ? channel : `${channel}:${reviewTaskId}`
}

function resolveStreams(channel: string, reviewTaskId: number | null, db: Db) {
  if (channel === CHANNELS.uiEvents) return [STREAMS.uiEvents]
  if (channel === CHANNELS.reviewNotifications) return [STREAMS.reviewNotifications]
  if (channel === CHANNELS.reviewTaskLogs) {
    if (reviewTaskId === null) return null
    const task = db.select({ id: reviewTasks.id }).from(reviewTasks).where(eq(reviewTasks.id, reviewTaskId)).get()
    return task ? [STREAMS.reviewTaskLogs(task.id)] : null
  }
  return null
}

function parseClientMessage(frame: unknown): ClientMessage | null {
  const value: unknown = typeof frame === 'string' ? safeJson(frame) : frame
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  if (!('type' in value) || typeof value.type !== 'string') return null
  if (value.type !== 'subscribe' && value.type !== 'unsubscribe') return null
  if (!('channel' in value) || typeof value.channel !== 'string') return null
  return {
    type: value.type,
    channel: value.channel,
    review_task_id: 'review_task_id' in value ? value.review_task_id : undefined,
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function channelPayload(key: string) {
  const separator = key.indexOf(':')
  if (separator === -1) return { channel: key }
  return {
    channel: key.slice(0, separator),
    review_task_id: Number.parseInt(key.slice(separator + 1), 10),
  }
}

export class RealtimeServer implements Broadcaster {
  private readonly connections = new Map<string, WsConnection>()
  private pingTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly db: Db) {}

  broadcast(stream: string, message: BroadcastMessage) {
    for (const connection of this.connections.values()) {
      for (const [key, streams] of connection.subscriptions) {
        if (!streams.includes(stream)) continue
        connection.send(JSON.stringify({ type: 'message', ...channelPayload(key), data: message }))
      }
    }
  }

  connectionCount() {
    return this.connections.size
  }

  open(id: string, send: (frame: string) => void, close: (code: number, reason: string) => void = () => {}) {
    this.connections.set(id, { send, close, subscriptions: new Map() })
    send(JSON.stringify({ type: 'welcome' }))
    this.startPinging()
  }

  receive(id: string, frame: unknown) {
    const connection = this.connections.get(id)
    const message = parseClientMessage(frame)
    if (!connection || !message) return

    const reviewTaskId = integerParam(message.review_task_id)
    const key = subscriptionKey(message.channel, message.channel === CHANNELS.reviewTaskLogs ? reviewTaskId : null)

    if (message.type === 'subscribe') this.subscribe(connection, message.channel, reviewTaskId, key)
    else connection.subscriptions.delete(key)
  }

  close(id: string) {
    this.connections.delete(id)
    if (this.connections.size === 0) this.stopPinging()
  }

  stop() {
    this.stopPinging()
    this.connections.clear()
  }

  disconnectAll(reason = 'server_restart') {
    const frame = JSON.stringify({ type: 'disconnect', reason, reconnect: true })
    for (const connection of this.connections.values()) {
      connection.send(frame)
      connection.close(GOING_AWAY, reason)
    }
    this.stop()
  }

  private subscribe(connection: WsConnection, channel: string, reviewTaskId: number | null, key: string) {
    if (connection.subscriptions.has(key)) return

    const streams = resolveStreams(channel, channel === CHANNELS.reviewTaskLogs ? reviewTaskId : null, this.db)
    if (streams === null) return

    connection.subscriptions.set(key, streams)
    connection.send(JSON.stringify({ type: 'subscribed', ...channelPayload(key) }))
  }

  private startPinging() {
    if (this.pingTimer) return
    this.pingTimer = setInterval(() => {
      const frame = JSON.stringify({ type: 'ping', ts: Math.floor(Date.now() / 1000) })
      for (const connection of this.connections.values()) connection.send(frame)
    }, PING_INTERVAL_MS)
  }

  private stopPinging() {
    clearInterval(this.pingTimer)
    this.pingTimer = undefined
  }
}

export interface RealtimeLimits {
  maxBufferedBytes: number
}

export const DEFAULT_REALTIME_LIMITS: RealtimeLimits = { maxBufferedBytes: 4 * 1024 * 1024 }

export function realtimeWebSocketOptions(limits: RealtimeLimits = DEFAULT_REALTIME_LIMITS) {
  return { backpressureLimit: limits.maxBufferedBytes, closeOnBackpressureLimit: true }
}

export function realtimePlugin(server: RealtimeServer) {
  return new Elysia({ name: 'realtime' }).ws(WS_PATH, {
    open(ws) {
      server.open(
        ws.id,
        (frame) => {
          ws.send(frame)
        },
        (code, reason) => ws.raw.close(code, reason),
      )
    },
    message(ws, message) {
      server.receive(ws.id, message)
    },
    close(ws) {
      server.close(ws.id)
    },
  })
}
