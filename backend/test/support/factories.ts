import type { Db } from '../../src/db/client'
import { agentLogs, pullRequests, pullRequestSnapshots, reviewComments, reviewIterations, reviewTasks } from '../../src/db/schema'

let sequence = 1

function next() {
  return sequence++
}

type PullRequestInsert = typeof pullRequests.$inferInsert
type ReviewTaskInsert = typeof reviewTasks.$inferInsert
type SnapshotInsert = typeof pullRequestSnapshots.$inferInsert
type CommentInsert = typeof reviewComments.$inferInsert
type IterationInsert = typeof reviewIterations.$inferInsert

// Raw inserts (no validation, no broadcasts) for arranging test state.
export function insertPullRequest(db: Db, attributes: Partial<PullRequestInsert> = {}) {
  const id = next()
  const now = new Date()
  const repoOwner = attributes.repoOwner ?? 'acme'
  const repoName = attributes.repoName ?? 'api'
  return db
    .insert(pullRequests)
    .values({
      githubId: id,
      number: id,
      title: `Pull request ${id}`,
      url: `https://github.com/${repoOwner}/${repoName}/pull/${id}`,
      reviewStatus: 'pending_review',
      createdAt: now,
      updatedAt: now,
      ...attributes,
      repoOwner,
      repoName,
    })
    .returning()
    .get()
}

export function insertReviewTask(db: Db, attributes: Partial<ReviewTaskInsert> & { pullRequestId: number }) {
  const now = new Date()
  return db
    .insert(reviewTasks)
    .values({ state: 'pending_review', cliClient: 'claude', reviewType: 'review', createdAt: now, updatedAt: now, ...attributes })
    .returning()
    .get()
}

export function insertSnapshot(db: Db, attributes: Partial<SnapshotInsert> & { pullRequestId: number }) {
  const id = next()
  const now = new Date()
  return db
    .insert(pullRequestSnapshots)
    .values({ headSha: `head${id}`, baseSha: `base${id}`, status: 'current', createdAt: now, updatedAt: now, ...attributes })
    .returning()
    .get()
}

export function insertReviewComment(db: Db, attributes: Partial<CommentInsert> & { reviewTaskId: number }) {
  const id = next()
  const now = new Date()
  return db
    .insert(reviewComments)
    .values({ filePath: `app/file_${id}.rb`, body: `Comment ${id}`, severity: 'minor', status: 'pending', createdAt: now, updatedAt: now, ...attributes })
    .returning()
    .get()
}

export function insertReviewIteration(db: Db, attributes: Partial<IterationInsert> & { reviewTaskId: number }) {
  const now = new Date()
  return db
    .insert(reviewIterations)
    .values({ iterationNumber: 1, cliClient: 'claude', reviewType: 'review', fromState: 'reviewed', toState: 'archived', createdAt: now, updatedAt: now, ...attributes })
    .returning()
    .get()
}

export function insertAgentLog(db: Db, attributes: { reviewTaskId: number; message?: string; logType?: string; createdAt?: Date }) {
  const now = attributes.createdAt ?? new Date()
  return db
    .insert(agentLogs)
    .values({ reviewTaskId: attributes.reviewTaskId, message: attributes.message ?? 'log line', logType: attributes.logType ?? 'output', createdAt: now, updatedAt: now })
    .returning()
    .get()
}
