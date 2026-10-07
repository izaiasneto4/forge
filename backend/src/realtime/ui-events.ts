import type { AppContext } from '../context'
import { iso8601 } from '../lib/ruby'
import { slugFromPath } from '../services/repo-slug-resolver'
import { STREAMS, type BroadcastMessage, type Broadcaster } from './broadcaster'

// Port of UiEventBroadcaster: app-wide events the React app listens to on UiEventsChannel.
export function broadcastUiEvent(events: Broadcaster, event: string, payload: BroadcastMessage = {}) {
  events.broadcast(STREAMS.uiEvents, { ...payload, event, timestamp: iso8601(new Date()) })
}

interface PullRequestEventSource {
  id: number
  reviewStatus: string | null
  repoOwner: string | null
  repoName: string | null
}

export function repoFullName(pullRequest: { repoOwner: string | null; repoName: string | null }) {
  return `${pullRequest.repoOwner ?? ''}/${pullRequest.repoName ?? ''}`
}

export function pullRequestUpdated(events: Broadcaster, pullRequest: PullRequestEventSource, previousStatus: string | null = null) {
  broadcastUiEvent(events, 'pull_request.updated', {
    pull_request_id: pullRequest.id,
    review_status: pullRequest.reviewStatus,
    previous_status: previousStatus,
    repo: repoFullName(pullRequest),
  })
}

export function reviewTaskUpdated(
  events: Broadcaster,
  reviewTask: { id: number; state: string; pullRequestId: number },
  pullRequest: { repoOwner: string | null; repoName: string | null } | undefined,
  previousState: string | null = null,
) {
  broadcastUiEvent(events, 'review_task.updated', {
    review_task_id: reviewTask.id,
    state: reviewTask.state,
    previous_state: previousState,
    pull_request_id: reviewTask.pullRequestId,
    repo: pullRequest ? repoFullName(pullRequest) : null,
  })
}

type SyncEventContext = Pick<AppContext, 'events' | 'commands'>

async function syncEvent({ events, commands }: SyncEventContext, event: string, repoPath: string | null, extra: BroadcastMessage) {
  broadcastUiEvent(events, event, { repo_path: repoPath, repo: await slugFromPath(commands, repoPath), ...extra })
}

export function syncStarted(ctx: SyncEventContext, repoPath: string | null, sync: BroadcastMessage | null = null) {
  return syncEvent(ctx, 'sync.started', repoPath, { sync })
}

export function syncCompleted(ctx: SyncEventContext, repoPath: string | null, sync: BroadcastMessage | null = null) {
  return syncEvent(ctx, 'sync.completed', repoPath, { sync })
}

export function syncFailed(ctx: SyncEventContext, repoPath: string | null, error: string, sync: BroadcastMessage | null = null) {
  return syncEvent(ctx, 'sync.failed', repoPath, { error, sync })
}
