import { and, inArray } from 'drizzle-orm'
import type { AppContext } from '../../context'
import { pullRequests } from '../../db/schema'
import { RecordInvalidError } from '../../lib/errors'
import { logger } from '../../lib/logger'
import { createPullRequest, notArchived, updatePullRequest } from '../../models/pull-request'
import { transaction } from '../../models/record'
import type { PullRequestDiff } from './diff-engine'
import { githubIdNumber, writeExactGithubId } from './github-id'
import { toPullRequestChanges } from './pull-request-attributes'

export interface ApplyChangesResult {
  created: number
  updated: number
  deleted: number
}

function logInvalid(prefix: string, work: () => void) {
  try {
    work()
  } catch (error) {
    if (error instanceof RecordInvalidError) logger.error(`${prefix}: ${error.message}`)
    throw error
  }
}

function applyCreates(ctx: AppContext, changes: PullRequestDiff) {
  logInvalid('Failed to create PR', () => {
    for (const attributes of changes.to_create) {
      const record = createPullRequest(ctx, { ...toPullRequestChanges(attributes), githubId: githubIdNumber(attributes.github_id) })
      writeExactGithubId(ctx.db, record.id, attributes.github_id)
    }
  })
}

function applyUpdates(ctx: AppContext, changes: PullRequestDiff) {
  logInvalid('Failed to update PR', () => {
    for (const [existing, attributes] of changes.to_update) {
      updatePullRequest(ctx, existing, toPullRequestChanges(attributes))
      if (existing.githubId !== githubIdNumber(attributes.github_id)) writeExactGithubId(ctx.db, existing.id, attributes.github_id)
    }
  })
}

// `PullRequest.where(id: ids).update_all(...)`: default scope, no callbacks.
function applyDeletes(ctx: AppContext, changes: PullRequestDiff) {
  if (changes.to_delete.length === 0) return
  const now = new Date()
  const ids = changes.to_delete.map((pullRequest) => pullRequest.id)
  ctx.db
    .update(pullRequests)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(inArray(pullRequests.id, ids), notArchived))
    .run()
}

// Port of Sync::ApplyChanges: writes a DiffEngine result in one transaction.
// Returns null when there is nothing to do.
export function applyChanges(ctx: AppContext, changes: PullRequestDiff): ApplyChangesResult | null {
  if (changes.to_create.length === 0 && changes.to_update.length === 0 && changes.to_delete.length === 0) return null

  transaction(ctx, (txCtx) => {
    applyCreates(txCtx, changes)
    applyUpdates(txCtx, changes)
    applyDeletes(txCtx, changes)
  })

  return { created: changes.to_create.length, updated: changes.to_update.length, deleted: changes.to_delete.length }
}
