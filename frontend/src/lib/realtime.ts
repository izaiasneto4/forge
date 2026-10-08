import { wsUrl } from './desktop'

type SubscriptionParams = {
  channel: string
  review_task_id?: number
}

type SubscriptionCallbacks = {
  received?: (data: unknown) => void
}

type ActiveSubscription = {
  params: SubscriptionParams
  listeners: Map<number, SubscriptionCallbacks>
}

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let nextListenerId = 1
const subscriptions = new Map<string, ActiveSubscription>()

function subscriptionKey(params: SubscriptionParams) {
  return params.review_task_id === undefined
    ? params.channel
    : `${params.channel}:${params.review_task_id}`
}

function clearReconnectTimer() {
  if (reconnectTimer === null) return
  clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function send(message: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message))
  }
}

function subscribeOnSocket(params: SubscriptionParams) {
  const payload: Record<string, unknown> = { type: 'subscribe', channel: params.channel }
  if (params.review_task_id !== undefined) payload.review_task_id = params.review_task_id
  send(payload)
}

function ensureSocket() {
  if (subscriptions.size === 0) return
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }

  const next = new WebSocket(wsUrl())
  socket = next

  next.addEventListener('open', () => {
    for (const subscription of subscriptions.values()) {
      subscribeOnSocket(subscription.params)
    }
  })

  next.addEventListener('message', (event) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
    if (!('type' in parsed) || parsed.type !== 'message') return
    if (!('channel' in parsed) || typeof parsed.channel !== 'string') return
    if (!('data' in parsed)) return

    const reviewTaskId =
      'review_task_id' in parsed && typeof parsed.review_task_id === 'number'
        ? parsed.review_task_id
        : undefined
    const key = subscriptionKey({ channel: parsed.channel, review_task_id: reviewTaskId })
    const entry = subscriptions.get(key)
    if (!entry) return
    for (const listener of entry.listeners.values()) {
      listener.received?.(parsed.data)
    }
  })

  next.addEventListener('close', () => {
    if (socket === next) socket = null
    if (subscriptions.size === 0) return
    if (reconnectTimer !== null) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (subscriptions.size === 0) return
      ensureSocket()
    }, 1000)
  })
}

export function subscribe(params: SubscriptionParams, callbacks: SubscriptionCallbacks) {
  const key = subscriptionKey(params)
  let entry = subscriptions.get(key)
  const isNewChannel = entry === undefined
  if (!entry) {
    entry = { params, listeners: new Map() }
    subscriptions.set(key, entry)
  }

  const listenerId = nextListenerId
  nextListenerId += 1
  entry.listeners.set(listenerId, callbacks)

  ensureSocket()
  if (isNewChannel && socket?.readyState === WebSocket.OPEN) subscribeOnSocket(params)

  return () => {
    const current = subscriptions.get(key)
    if (!current) return
    current.listeners.delete(listenerId)
    if (current.listeners.size > 0) return

    subscriptions.delete(key)
    send({
      type: 'unsubscribe',
      channel: params.channel,
      ...(params.review_task_id === undefined ? {} : { review_task_id: params.review_task_id }),
    })
    if (subscriptions.size > 0) return

    clearReconnectTimer()
    if (socket) {
      socket.close()
      socket = null
    }
  }
}
