export type BroadcastMessage = Record<string, unknown>

export interface Broadcaster {
  broadcast(stream: string, message: BroadcastMessage): void
}

export const STREAMS = Object.freeze({
  uiEvents: 'ui_events',
  reviewNotifications: 'review_notifications',
  reviewTaskLogs: (reviewTaskId: number) => `review_task_${reviewTaskId}_logs`,
})
