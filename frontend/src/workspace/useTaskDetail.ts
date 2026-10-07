import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../lib/api'
import { subscribe } from '../lib/realtime'
import { queryKeys } from '../lib/queryKeys'
import type { AgentLogItem, ReviewTaskDetailResponse } from '../types/api'

const REFRESH_EVENTS = new Set(['completed', 'failed', 'retry_scheduled', 'preparing'])

export function useTaskDetail(taskId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.reviewTaskDetail(String(taskId ?? '')),
    queryFn: () => api.get<ReviewTaskDetailResponse>(`/api/v1/review_tasks/${taskId}`),
    enabled: taskId != null,
  })
}

function isLogType(value: unknown): value is AgentLogItem['log_type'] {
  return value === 'output' || value === 'error' || value === 'status'
}

function parseLog(data: unknown): AgentLogItem | null {
  if (!data || typeof data !== 'object') return null
  if (!('id' in data) || typeof data.id !== 'number') return null
  if (!('message' in data) || typeof data.message !== 'string') return null
  if (!('log_type' in data) || !isLogType(data.log_type)) return null
  if (!('created_at' in data) || typeof data.created_at !== 'string') return null

  return { id: data.id, message: data.message, log_type: data.log_type, created_at: data.created_at }
}

function lifecycleEvent(data: unknown) {
  if (!data || typeof data !== 'object' || !('type' in data) || typeof data.type !== 'string') return null
  return data.type
}

export function useLiveLogs(taskId: number | null | undefined, initialLogs: AgentLogItem[], live: boolean) {
  const queryClient = useQueryClient()

  // Each time a run goes live starts a new session, so lines streamed for an earlier run
  // never mix into the next one even if its "preparing" broadcast was missed.
  const liveKey = live && taskId != null ? taskId : null
  const [session, setSession] = useState({ liveKey, count: 0 })
  if (session.liveKey !== liveKey) setSession({ liveKey, count: liveKey === null ? session.count : session.count + 1 })
  const sessionId = `${taskId ?? 'none'}:${session.count}`

  const [streamed, setStreamed] = useState<{ sessionId: string; logs: AgentLogItem[] }>({ sessionId, logs: [] })

  useEffect(() => {
    if (taskId == null || !live) return

    return subscribe(
      { channel: 'review_task_logs', review_task_id: taskId },
      {
        received: (data) => {
          const event = lifecycleEvent(data)
          if (event && REFRESH_EVENTS.has(event)) {
            // The server clears the log when a new run starts; drop what was streamed for the old one.
            if (event === 'preparing') setStreamed({ sessionId, logs: [] })
            queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskDetail(String(taskId)) })
            queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
            return
          }

          const log = parseLog(data)
          if (log) setStreamed((current) => ({ sessionId, logs: current.sessionId === sessionId ? [...current.logs, log] : [log] }))
        },
      },
    )
  }, [taskId, live, sessionId, queryClient])

  return useMemo(() => {
    const seen = new Set(initialLogs.map((log) => log.id))
    const extra = streamed.sessionId === sessionId ? streamed.logs.filter((log) => !seen.has(log.id)) : []
    return [...initialLogs, ...extra]
  }, [initialLogs, streamed, sessionId])
}
