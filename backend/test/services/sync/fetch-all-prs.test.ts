import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createFetchAllPrs, FetchAllPrsError, PR_FETCH_LIMIT } from '../../../src/services/sync/fetch-all-prs'
import { createTestContext, type TestContext } from '../../support/context'
import { createTempFolder } from '../../support/git'
import { ghJson, ghListedPullRequest } from '../../support/github-fixtures'

const login = 'alice'
const requestedSearch = ['gh', 'pr', 'list', '--search', 'review-requested:@me']
const reviewedSearch = ['gh', 'pr', 'list', '--search', 'reviewed-by:@me']
const openList = ['gh', 'pr', 'list', '--state', 'open']

describe('FetchAllPrs (Sync::FetchAllPrs)', () => {
  const tempFolder = createTempFolder()
  let ctx: TestContext

  afterAll(() => tempFolder.remove())

  beforeEach(() => {
    ctx = createTestContext()
  })

  function service() {
    return createFetchAllPrs(ctx, { repoPath: null, githubLogin: login })
  }

  test('call combines pending and reviewed prs', async () => {
    const pending = ghListedPullRequest({ number: 1 })
    const reviewed = ghListedPullRequest({ number: 2 })
    ctx.commands.on(requestedSearch, { stdout: ghJson([pending]) })
    ctx.commands.on(reviewedSearch, { stdout: ghJson([reviewed]) })

    const result = await (await service()).call()

    expect(result.map((pr) => pr.number)).toEqual([pending.number, reviewed.number])
    expect(result.map((pr) => pr.review_status)).toEqual(['pending_review', 'reviewed_by_me'])
    expect(ctx.commands.calls.map(({ command }) => command.at(-1))).toEqual([String(PR_FETCH_LIMIT), String(PR_FETCH_LIMIT)])
  })

  test('call flags reviewed prs whose review was requested again', async () => {
    const both = ghListedPullRequest({ number: 1 })
    ctx.commands.on(requestedSearch, { stdout: ghJson([both]) })
    ctx.commands.on(reviewedSearch, { stdout: ghJson([both]) })

    const result = await (await service()).call()

    expect(result.map((pr) => [pr.review_status, pr.review_requested_for_me])).toEqual([
      ['pending_review', false],
      ['reviewed_by_me', true],
    ])
  })

  test('callWithOpenPrs removes reviewed duplicates that are still open', async () => {
    const requested = ghListedPullRequest({ number: 1 })
    const reviewedDuplicate = ghListedPullRequest({ number: 2 })
    const reviewedUnique = ghListedPullRequest({ number: 3 })
    ctx.commands.on(requestedSearch, { stdout: ghJson([requested]) })
    ctx.commands.on(reviewedSearch, { stdout: ghJson([reviewedDuplicate, reviewedUnique]) })
    ctx.commands.on(openList, { stdout: ghJson([requested, reviewedDuplicate]) })

    const result = await (await service()).callWithOpenPrs()

    expect(result.pending_review.map((pr) => pr.number)).toEqual([requested.number])
    expect(result.reviewed_by_me.map((pr) => pr.number)).toEqual([reviewedDuplicate.number, reviewedUnique.number])
    expect(result.pending_review[0]?.review_requested_for_me).toBe(true)
  })

  test('runs gh inside the repo path when it exists, e.g. to look up the login', async () => {
    const repoPath = join(tempFolder.path, 'repo')
    mkdirSync(repoPath)
    ctx.commands.on(['gh', 'api', 'user', '--jq', '.login'], { stdout: `${login}\n` })

    const fetcher = await createFetchAllPrs(ctx, { repoPath, githubLogin: null })

    expect(fetcher.githubLogin).toBe(login)
    expect(ctx.commands.calls[0]?.options.cwd).toBe(repoPath)
  })

  test('runGhCommand raises a wrapped error on gh failure', async () => {
    const stderr = 'bad'
    ctx.commands.on(['gh'], { stderr, exitCode: 1 })
    const fetcher = await service()

    const failure = fetcher.runGhCommand(['api', 'user'])

    await expect(failure).rejects.toThrow(FetchAllPrsError)
    await expect(failure).rejects.toThrow(`GitHub CLI error: ${stderr}`)
  })

  test('parsePr falls back to the head repository owner when the url does not match', async () => {
    const headOwner = 'fallback'

    const result = (await service()).parsePr(ghListedPullRequest({ number: 4, url: 'https://example.com/custom/4', headRepositoryOwner: { login: headOwner } }))

    expect(result.repo_owner).toBe(headOwner)
    expect(result.repo_name).toBeNull()
    expect(result.review_requested_for_me).toBe(false)
  })
})
