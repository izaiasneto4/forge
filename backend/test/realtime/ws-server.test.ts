import { describe, expect, test } from 'bun:test'
import { CHANNELS, RealtimeServer } from '../../src/realtime/ws-server'
import { STREAMS } from '../../src/realtime/broadcaster'
import { createTestDatabase } from '../support/database'
import { insertPullRequest, insertReviewTask } from '../support/factories'

function connect(server: RealtimeServer, id = 'connection-1') {
  const frames: unknown[] = []
  server.open(id, (frame) => frames.push(JSON.parse(frame)))
  return { id, frames }
}

describe('RealtimeServer', () => {
  test('welcomes, confirms subscriptions and routes broadcasts by channel', () => {
    const server = new RealtimeServer(createTestDatabase())
    const client = connect(server)
    const message = { event: 'pull_request.updated' }

    server.receive(client.id, { type: 'subscribe', channel: CHANNELS.uiEvents })
    server.broadcast(STREAMS.uiEvents, message)
    server.broadcast(STREAMS.reviewNotifications, { ignored: true })

    expect(client.frames).toEqual([
      { type: 'welcome' },
      { type: 'subscribed', channel: CHANNELS.uiEvents },
      { type: 'message', channel: CHANNELS.uiEvents, data: message },
    ])
    server.stop()
  })

  test('accepts commands as raw JSON strings too', () => {
    const server = new RealtimeServer(createTestDatabase())
    const client = connect(server)

    server.receive(client.id, JSON.stringify({ type: 'subscribe', channel: CHANNELS.uiEvents }))

    expect(client.frames).toContainEqual({ type: 'subscribed', channel: CHANNELS.uiEvents })
    server.stop()
  })

  test('stops delivering after unsubscribe and ignores duplicate subscribes', () => {
    const server = new RealtimeServer(createTestDatabase())
    const client = connect(server)
    const subscribe = { type: 'subscribe', channel: CHANNELS.uiEvents }

    server.receive(client.id, subscribe)
    server.receive(client.id, subscribe)
    server.receive(client.id, { type: 'unsubscribe', channel: CHANNELS.uiEvents })
    server.broadcast(STREAMS.uiEvents, { event: 'late' })

    expect(client.frames.filter((frame) => JSON.stringify(frame).includes('subscribed'))).toHaveLength(1)
    expect(client.frames.filter((frame) => JSON.stringify(frame).includes('late'))).toHaveLength(0)
    server.stop()
  })

  test('streams review task logs only for tasks that exist', () => {
    const db = createTestDatabase()
    const task = insertReviewTask(db, { pullRequestId: insertPullRequest(db).id })
    const server = new RealtimeServer(db)
    const client = connect(server)
    const logMessage = { id: 1, message: 'Starting review...' }

    server.receive(client.id, { type: 'subscribe', channel: CHANNELS.reviewTaskLogs, review_task_id: task.id })
    server.receive(client.id, { type: 'subscribe', channel: CHANNELS.reviewTaskLogs, review_task_id: task.id + 1000 })
    server.broadcast(STREAMS.reviewTaskLogs(task.id), logMessage)

    expect(client.frames).toContainEqual({
      type: 'message',
      channel: CHANNELS.reviewTaskLogs,
      review_task_id: task.id,
      data: logMessage,
    })
    expect(JSON.stringify(client.frames)).not.toContain(String(task.id + 1000))
    server.stop()
  })

  test('ignores unknown channels and malformed frames', () => {
    const server = new RealtimeServer(createTestDatabase())
    const client = connect(server)

    server.receive(client.id, { type: 'subscribe', channel: 'nope' })
    server.receive(client.id, 'not json')
    server.receive(client.id, { type: 'subscribe' })

    expect(client.frames).toEqual([{ type: 'welcome' }])
    server.stop()
  })
})

describe('RealtimeServer shutdown', () => {
  test('tells every client to reconnect and closes its socket', () => {
    const server = new RealtimeServer(createTestDatabase())
    const frames: unknown[] = []
    const closes: Array<[number, string]> = []
    server.open('connection-1', (frame) => frames.push(JSON.parse(frame)), (code, reason) => closes.push([code, reason]))

    server.disconnectAll()

    expect(frames).toContainEqual({ type: 'disconnect', reason: 'server_restart', reconnect: true })
    expect(closes).toEqual([[1001, 'server_restart']])
    expect(server.connectionCount()).toBe(0)
  })
})
