import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createPullRequest, updatePullRequestColumns } from '../../../src/models/pull-request'
import { DiffEngine } from '../../../src/services/sync/diff-engine'
import { toPullRequestChanges, type PullRequestAttributes } from '../../../src/services/sync/pull-request-attributes'
import { createTestContext, type TestContext } from '../../support/context'
import { createTempFolder } from '../../support/git'
import { fixtureOwner, fixtureRepo, fixtureSlug, pullRequestUrl } from '../../support/github-fixtures'

function baseAttrs(options: { id: number; number: number; title?: string; reviewStatus?: string }): PullRequestAttributes {
  return {
    github_id: BigInt(options.id),
    number: options.number,
    title: options.title ?? 'PR',
    description: 'Body',
    url: pullRequestUrl(options.number),
    repo_owner: fixtureOwner,
    repo_name: fixtureRepo,
    author: 'alice',
    author_avatar: 'https://example.com/a.png',
    created_at_github: '2026-03-04T10:00:00Z',
    updated_at_github: '2026-03-04T10:00:00Z',
    review_status: options.reviewStatus ?? 'pending_review',
  }
}

describe('DiffEngine (Sync::DiffEngine)', () => {
  const tempFolder = createTempFolder()
  let repoPath: string
  let ctx: TestContext

  beforeAll(() => {
    repoPath = join(tempFolder.path, 'repo')
    mkdirSync(repoPath)
  })

  afterAll(() => tempFolder.remove())

  beforeEach(() => {
    ctx = createTestContext()
    ctx.commands.on(['git', '-C', repoPath, 'remote', 'get-url', 'origin'], { stdout: `git@github.com:${fixtureSlug}.git\n` })
  })

  function create(attributes: PullRequestAttributes) {
    return createPullRequest(ctx, { ...toPullRequestChanges(attributes), githubId: Number(attributes.github_id) })
  }

  test('returns an empty result when fetched prs are blank', async () => {
    const result = await new DiffEngine(ctx, { fetchedPrs: [], repoPath }).call()

    expect(result).toEqual({ to_create: [], to_update: [], to_delete: [] })
    expect(ctx.commands.calls).toEqual([])
  })

  test('returns an empty result when repo info cannot be determined', async () => {
    const missingPath = join(tempFolder.path, 'missing')

    const result = await new DiffEngine(ctx, { fetchedPrs: [baseAttrs({ id: 1, number: 1 })], repoPath: missingPath }).call()

    expect(result).toEqual({ to_create: [], to_update: [], to_delete: [] })
  })

  test('classifies creates, updates, restores and deletes', async () => {
    const existingSame = create(baseAttrs({ id: 1, number: 1 }))
    create(baseAttrs({ id: 2, number: 2, title: 'Old' }))
    const existingDeleted = create(baseAttrs({ id: 3, number: 3 }))
    updatePullRequestColumns(ctx.db, existingDeleted.id, { deletedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
    create(baseAttrs({ id: 4, number: 4 }))
    const archived = create(baseAttrs({ id: 5, number: 5 }))
    updatePullRequestColumns(ctx.db, archived.id, { archived: true })
    const fetched = [
      baseAttrs({ id: 1, number: 1 }),
      baseAttrs({ id: 2, number: 2, title: 'New' }),
      baseAttrs({ id: 3, number: 3 }),
      baseAttrs({ id: 6, number: 6 }),
    ]

    const result = await new DiffEngine(ctx, { fetchedPrs: fetched, repoPath }).call()

    const restore = result.to_update.find(([existing]) => existing.id === existingDeleted.id)?.[1]
    expect(result.to_create.map((attrs) => attrs.github_id)).toEqual([6n])
    // PR 1 is unchanged but still listed: Rails compares "2026-03-04 10:00:00 UTC" with "2026-03-04T10:00:00Z".
    expect(result.to_update.map(([existing]) => existing.githubId)).toEqual([1, 2, 3])
    expect(result.to_delete.map((pullRequest) => pullRequest.githubId)).toEqual([4])
    expect(result.to_delete.map((pullRequest) => pullRequest.githubId)).not.toContain(archived.githubId)
    expect(restore?.archived).toBe(false)
    expect(restore?.deleted_at).toBeNull()
    expect(result.to_update[0]?.[0].id).toBe(existingSame.id)
  })

  test('treats a PR without GitHub timestamps and with equal fields as unchanged', async () => {
    const attributes = { ...baseAttrs({ id: 7, number: 7 }), created_at_github: null, updated_at_github: null, review_requested_for_me: false }
    create(attributes)

    const result = await new DiffEngine(ctx, { fetchedPrs: [attributes], repoPath }).call()

    expect(result).toEqual({ to_create: [], to_update: [], to_delete: [] })
  })

  test('memoizes the repo lookup and ignores remotes outside GitHub', async () => {
    const otherPath = join(tempFolder.path, 'gitlab')
    mkdirSync(otherPath)
    ctx.commands.on(['git', '-C', otherPath], { stdout: 'git@gitlab.com:acme/api.git\n' })
    const engine = new DiffEngine(ctx, { fetchedPrs: [baseAttrs({ id: 1, number: 1 })], repoPath: otherPath })

    expect(await engine.call()).toEqual({ to_create: [], to_update: [], to_delete: [] })
    expect(await engine.getRepoInfo()).toBeNull()
    expect(ctx.commands.calls).toHaveLength(1)
  })
})
