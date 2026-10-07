import { literals } from '../lib/literals'
import { isPresent } from '../lib/ruby'
import { isActiveRemote, type PullRequestRecord } from '../models/pull-request'
import type { ReviewTaskRecord } from '../models/review-task'

// Collapses PullRequest#review_status and ReviewTask#state into the single
// lifecycle the frontend organizes around (inbox, reviewing, waiting, settled).
export const LIFECYCLES = literals('needs_review', 'queued', 'reviewing', 'ready', 'failed', 'waiting', 'settled', 'authored')
export type Lifecycle = (typeof LIFECYCLES)[number]

export interface LifecycleInputs {
  pullRequest: PullRequestRecord
  task: ReviewTaskRecord | undefined
  githubLogin: string | null
  // Whether the task's analysis predates the PR's current snapshot (new commits).
  analysisStale: boolean
  reviewJobPending: boolean
}

export function hasNewCommits({ task, analysisStale }: Pick<LifecycleInputs, 'task' | 'analysisStale'>) {
  return task !== undefined && analysisStale
}

function authoredBy(pullRequest: PullRequestRecord, githubLogin: string | null) {
  if (!isPresent(githubLogin)) return false
  return (pullRequest.author ?? '').toLowerCase() === githubLogin.toLowerCase()
}

function reviewedLifecycle(task: ReviewTaskRecord, newCommits: boolean): Lifecycle {
  if (task.submissionStatus !== 'submitted') return 'ready'
  return newCommits ? 'needs_review' : 'settled'
}

function taskLifecycle(task: ReviewTaskRecord, inputs: LifecycleInputs): Lifecycle {
  if (task.archived) return 'settled'
  const newCommits = hasNewCommits(inputs)

  switch (task.state) {
    case 'queued':
      return 'queued'
    case 'in_review':
      return 'reviewing'
    case 'pending_review':
      return inputs.reviewJobPending ? 'reviewing' : 'needs_review'
    case 'failed_review':
      return 'failed'
    case 'waiting_implementation':
      return 'waiting'
    case 'done':
      return newCommits ? 'needs_review' : 'settled'
    default:
      return reviewedLifecycle(task, newCommits)
  }
}

export function pullRequestLifecycle(inputs: LifecycleInputs): Lifecycle {
  const { pullRequest, task, githubLogin } = inputs
  if (!isActiveRemote(pullRequest)) return 'settled'
  if (task) return taskLifecycle(task, inputs)
  if (authoredBy(pullRequest, githubLogin)) return 'authored'
  if (pullRequest.reviewStatus === 'reviewed_by_me') return 'settled'
  return 'needs_review'
}
