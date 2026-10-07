export type BroadcastMessage = Record<string, unknown>

// ActionCable.server.broadcast(stream, message). The cable server delivers each
// message to every subscription streaming from `stream`.
export interface Broadcaster {
  broadcast(stream: string, message: BroadcastMessage): void
}

export const STREAMS = Object.freeze({
  uiEvents: 'ui_events',
  reviewNotifications: 'review_notifications',
  reviewTaskLogs: (reviewTaskId: number) => `review_task_${reviewTaskId}_logs`,
})
