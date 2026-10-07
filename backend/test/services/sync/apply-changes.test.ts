import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { pullRequests } from '../../../src/db/schema'
import { RecordInvalidError } from '../../../src/lib/errors'
import { createPullRequest, findPullRequestUnscoped } from '../../../src/models/pull-request'
import { STREAMS } from '../../../src/realtime/broadcaster'
import { applyChanges } from '../../../src/services/sync/apply-changes'
import { findPullRequestByGithubId } from '../../../src/services/sync/github-id'
import { toPullRequestChanges, type PullRequestAttributes } from '../../../src/services/sync/pull-request-attributes'
import { createTestContext, type TestContext } from '../../support/context'
import { fixtureOwner, fixtureRepo, githubIdFor, pullRequestUrl } from '../../support/github-fixtures'

function baseAttrs(options: { id: bigint; number: number; title?: string }): PullRequestAttributes {
  return {
    github_id: options.id,
    number: options.number,
    title: options.title ?? 'PR',
    url: pullRequestUrl(options.number),
    repo_owner: fixtureOwner,
    repo_name: fixtureRepo,
    review_status: 'pending_review',
  }
}

function create(ctx: TestContext, attributes: PullRequestAttributes) {
  return createPullRequest(ctx, { ...toPullRequestChanges(attributes), githubId: Number(attributes.github_id) })
}

describe('applyChanges (Sync::ApplyChanges)', () => {
  test('returns null when there are no changes', () => {
    const ctx = createTestContext()

    expect(applyChanges(ctx, { to_create: [], to_update: [], to_delete: [] })).toBeNull()
  })

  test('creates, updates and soft-deletes pull requests', () => {
    const ctx = createTestContext()
    const newTitle = 'New'
    const existing = create(ctx, baseAttrs({ id: 1n, number: 1, title: 'Old' }))
    const deleted = create(ctx, baseAttrs({ id: 2n, number: 2 }))
    const toCreate = baseAttrs({ id: 3n, number: 3 })

    const result = applyChanges(ctx, {
      to_create: [toCreate],
      to_update: [[existing, baseAttrs({ id: 1n, number: 1, title: newTitle })]],
      to_delete: [deleted],
    })

    expect(result).toEqual({ created: 1, updated: 1, deleted: 1 })
    expect(findPullRequestUnscoped(ctx.db, existing.id)?.title).toBe(newTitle)
    expect(findPullRequestByGithubId(ctx.db, toCreate.github_id)).toBeDefined()
    expect(findPullRequestUnscoped(ctx.db, deleted.id)?.deletedAt).toBeInstanceOf(Date)
  })

  test('stores the exact 62-bit github id for created pull requests', () => {
    const ctx = createTestContext()
    const number = 42
    const githubId = githubIdFor(number)

    applyChanges(ctx, { to_create: [baseAttrs({ id: githubId, number })], to_update: [], to_delete: [] })

    const stored = ctx.db.select({ githubId: sql<string>`CAST(${pullRequests.githubId} AS TEXT)` }).from(pullRequests).get()
    expect(stored?.githubId).toBe(githubId.toString())
  })

  test('rolls everything back, without broadcasts, when a record is invalid', () => {
    const ctx = createTestContext()
    const valid = baseAttrs({ id: 10n, number: 10 })
    const invalid = { ...baseAttrs({ id: 11n, number: 11 }), title: null }

    expect(() => applyChanges(ctx, { to_create: [valid, invalid], to_update: [], to_delete: [] })).toThrow(RecordInvalidError)
    expect(findPullRequestByGithubId(ctx.db, valid.github_id)).toBeUndefined()
    expect(ctx.events.on(STREAMS.uiEvents)).toEqual([])
  })
})
