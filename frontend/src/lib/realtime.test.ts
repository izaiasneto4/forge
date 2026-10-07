import { afterEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: { data?: string }) => void

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  readonly sent: string[] = []
  readonly url: string
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    const bucket = this.listeners.get(type) ?? new Set<Listener>()
    bucket.add(listener)
    this.listeners.set(type, bucket)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close')
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.emit('open')
  }

  emitMessage(payload: unknown) {
    this.emit('message', { data: JSON.stringify(payload) })
  }

  private emit(type: string, event: { data?: string } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

describe('realtime subscribe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    FakeWebSocket.instances = []
    vi.useRealTimers()
  })

  it('fan-outs the same channel to every listener and only unsubscribes when the last one leaves', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const { subscribe } = await import('./realtime')

    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribe({ channel: 'ui_events' }, { received: first })
    const unsubscribeSecond = subscribe({ channel: 'ui_events' }, { received: second })

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()
    socket?.open()
    expect(socket?.sent.filter((frame) => frame.includes('"subscribe"'))).toHaveLength(1)

    socket?.emitMessage({ type: 'message', channel: 'ui_events', data: { event: 'sync.started' } })
    expect(first).toHaveBeenCalledWith({ event: 'sync.started' })
    expect(second).toHaveBeenCalledWith({ event: 'sync.started' })

    unsubscribeFirst()
    expect(socket?.sent.some((frame) => frame.includes('"unsubscribe"'))).toBe(false)

    unsubscribeSecond()
    expect(socket?.sent.some((frame) => frame.includes('"unsubscribe"'))).toBe(true)
    expect(socket?.readyState).toBe(FakeWebSocket.CLOSED)
  })

  it('does not open a reconnect socket after the last subscriber leaves', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const { subscribe } = await import('./realtime')

    const unsubscribe = subscribe({ channel: 'ui_events' }, { received: vi.fn() })
    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()
    socket?.open()
    socket?.close()

    unsubscribe()
    await vi.advanceTimersByTimeAsync(1500)

    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
