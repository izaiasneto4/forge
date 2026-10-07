import { describe, expect, test } from 'bun:test'
import { CableServer } from '../../src/realtime/cable-server'
import { STREAMS } from '../../src/realtime/broadcaster'
import { createTestDatabase } from '../support/database'
import { insertPullRequest, insertReviewTask } from '../support/factories'

function connect(server: CableServer, id = 'connection-1') {
  const frames: unknown[] = []
  server.open(id, (frame) => frames.push(JSON.parse(frame)))
  return { id, frames }
}

const uiIdentifier = JSON.stringify({ channel: 'UiEventsChannel' })

describe('CableServer', () => {
  test('welcomes, confirms subscriptions and routes broadcasts by identifier', () => {
    const server = new CableServer(createTestDatabase())
    const client = connect(server)
    const message = { event: 'pull_request.updated' }

    server.receive(client.id, { command: 'subscribe', identifier: uiIdentifier })
    server.broadcast(STREAMS.uiEvents, message)
    server.broadcast(STREAMS.reviewNotifications, { ignored: true })

    expect(client.frames).toEqual([
      { type: 'welcome' },
      { identifier: uiIdentifier, type: 'confirm_subscription' },
      { identifier: uiIdentifier, message },
    ])
    server.stop()
  })

  test('accepts commands as raw JSON strings too', () => {
    const server = new CableServer(createTestDatabase())
    const client = connect(server)

    server.receive(client.id, JSON.stringify({ command: 'subscribe', identifier: uiIdentifier }))

    expect(client.frames).toContainEqual({ identifier: uiIdentifier, type: 'confirm_subscription' })
    server.stop()
  })

  test('stops delivering after unsubscribe and ignores duplicate subscribes', () => {
    const server = new CableServer(createTestDatabase())
    const client = connect(server)
    const subscribe = { command: 'subscribe', identifier: uiIdentifier }

    server.receive(client.id, subscribe)
    server.receive(client.id, subscribe)
    server.receive(client.id, { command: 'unsubscribe', identifier: uiIdentifier })
    server.broadcast(STREAMS.uiEvents, { event: 'late' })

    expect(client.frames.filter((frame) => JSON.stringify(frame).includes('confirm_subscription'))).toHaveLength(1)
    expect(client.frames.filter((frame) => JSON.stringify(frame).includes('late'))).toHaveLength(0)
    server.stop()
  })

  test('streams review task logs only for tasks that exist', () => {
    const db = createTestDatabase()
    const task = insertReviewTask(db, { pullRequestId: insertPullRequest(db).id })
    const server = new CableServer(db)
    const client = connect(server)
    const existingIdentifier = JSON.stringify({ channel: 'ReviewTaskLogsChannel', review_task_id: task.id })
    const missingIdentifier = JSON.stringify({ channel: 'ReviewTaskLogsChannel', review_task_id: task.id + 1000 })
    const logMessage = { id: 1, message: 'Starting review...' }

    server.receive(client.id, { command: 'subscribe', identifier: existingIdentifier })
    server.receive(client.id, { command: 'subscribe', identifier: missingIdentifier })
    server.broadcast(STREAMS.reviewTaskLogs(task.id), logMessage)

    expect(client.frames).toContainEqual({ identifier: existingIdentifier, message: logMessage })
    expect(JSON.stringify(client.frames)).not.toContain(String(task.id + 1000))
    server.stop()
  })

  test('ignores unknown channels and malformed frames', () => {
    const server = new CableServer(createTestDatabase())
    const client = connect(server)

    server.receive(client.id, { command: 'subscribe', identifier: JSON.stringify({ channel: 'NopeChannel' }) })
    server.receive(client.id, 'not json')
    server.receive(client.id, { command: 'subscribe', identifier: 'not json either' })

    expect(client.frames).toEqual([{ type: 'welcome' }])
    server.stop()
  })
})

describe('CableServer shutdown', () => {
  test('tells every client to reconnect and closes its socket', () => {
    const server = new CableServer(createTestDatabase())
    const frames: unknown[] = []
    const closes: Array<[number, string]> = []
    server.open('connection-1', (frame) => frames.push(JSON.parse(frame)), (code, reason) => closes.push([code, reason]))

    server.disconnectAll()

    expect(frames).toContainEqual({ type: 'disconnect', reason: 'server_restart', reconnect: true })
    expect(closes).toEqual([[1001, 'server_restart']])
    expect(server.connectionCount()).toBe(0)
  })
})
