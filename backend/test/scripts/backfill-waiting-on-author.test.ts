import { beforeEach, describe, expect, test } from 'bun:test'
import { SettingStore } from '../../src/models/setting'
import {
  backfillOptionsFromEnv,
  backfillWaitingOnAuthor,
  createGhReviewStateClient,
} from '../../src/scripts/backfill-waiting-on-author'
import type { OutputWriter } from '../../src/scripts/script-context'
import { GithubCliError } from '../../src/services/github-cli-client'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest, insertReviewTask } from '../support/factories'
import { createTempFolder } from '../support/git'

class RecordingOutput implements OutputWriter {
  readonly lines: string[] = []

  puts(line: string) {
    this.lines.push(line)
  }
}

const login = 'octocat'
const pullRequest = { repoOwner: 'acme', repoName: 'api', number: 7 }
const pullEndpoint = `/repos/${pullRequest.repoOwner}/${pullRequest.repoName}/pulls/${pullRequest.number}`

let ctx: TestContext

beforeEach(() => {
  ctx = createTestContext()
})

describe('backfillOptionsFromEnv', () => {
  const cases: Array<[Record<string, string | undefined>, { apply: boolean; limit: number | null }]> = [
    [{}, { apply: false, limit: null }],
    [{ APPLY: '1' }, { apply: true, limit: null }],
    [{ APPLY: 'true' }, { apply: false, limit: null }],
    [{ LIMIT: '5' }, { apply: false, limit: 5 }],
    [{ LIMIT: '0' }, { apply: false, limit: null }],
    [{ LIMIT: '' }, { apply: false, limit: null }],
    [{ LIMIT: 'abc' }, { apply: false, limit: null }],
    [{ LIMIT: ' 12abc' }, { apply: false, limit: 12 }],
  ]
  test.each(cases)('parses %p', (env, expected) => {
    expect(backfillOptionsFromEnv(env)).toEqual(expected)
  })
})

describe('backfillWaitingOnAuthor', () => {
  test('runs the backfill with APPLY and LIMIT from the environment', async () => {
    const limit = 1
    for (let index = 0; index < limit + 1; index += 1) {
      const submitted = insertPullRequest(ctx.db, { reviewStatus: 'reviewed_by_me' })
      insertReviewTask(ctx.db, { pullRequestId: submitted.id, state: 'reviewed', submissionStatus: 'submitted' })
    }
    const github = { reviewRequestedForMe: async () => false, latestMyReviewState: async () => 'APPROVED' }

    const summary = await backfillWaitingOnAuthor(ctx, github, { APPLY: '1', LIMIT: String(limit) }, new RecordingOutput())

    expect(summary).toEqual({ processed: limit, updated: limit, skipped: 0, failed: 0, mode: 'apply' })
  })
})

describe('createGhReviewStateClient', () => {
  function stubLogin() {
    ctx.commands.on(['gh', 'api', 'user'], { stdout: `${login}\n` })
  }

  test('resolves the gh login and stores it as the GitHub login setting', async () => {
    stubLogin()

    await createGhReviewStateClient(ctx)

    expect(ctx.commands.calls[0]?.command).toEqual(['gh', 'api', 'user', '--jq', '.login'])
    expect(new SettingStore(ctx.db).githubLogin()).toBe(login)
  })

  test('fails like GithubCliService.new when gh cannot resolve the user', async () => {
    const stderr = 'not logged in'
    ctx.commands.on(['gh', 'api', 'user'], { success: false, stderr })

    await expect(createGhReviewStateClient(ctx)).rejects.toBeInstanceOf(GithubCliError)
  })

  test('runs gh in the current repo when it exists', async () => {
    const repo = createTempFolder()
    new SettingStore(ctx.db).setCurrentRepo(repo.path)
    stubLogin()

    await createGhReviewStateClient(ctx)

    expect(ctx.commands.calls[0]?.options.cwd).toBe(repo.path)
    repo.remove()
  })

  test('reviewRequestedForMe checks the requested reviewers', async () => {
    stubLogin()
    ctx.commands.on(['gh', 'api', pullEndpoint], { stdout: JSON.stringify({ requested_reviewers: [{ login: 'someone' }, { login }] }) })
    const client = await createGhReviewStateClient(ctx)

    expect(await client.reviewRequestedForMe(pullRequest)).toBe(true)
  })

  test('reviewRequestedForMe is false without requested reviewers', async () => {
    stubLogin()
    ctx.commands.on(['gh', 'api', pullEndpoint], { stdout: JSON.stringify({ requested_reviewers: null }) })
    const client = await createGhReviewStateClient(ctx)

    expect(await client.reviewRequestedForMe(pullRequest)).toBe(false)
  })

  test('latestMyReviewState returns my most recently submitted review state', async () => {
    const latestState = 'CHANGES_REQUESTED'
    const reviews = [
      { user: { login }, state: 'COMMENTED', submitted_at: '2026-01-01T10:00:00Z' },
      { user: { login }, state: latestState, submitted_at: '2026-01-02T10:00:00Z' },
      { user: { login: 'someone' }, state: 'APPROVED', submitted_at: '2026-01-03T10:00:00Z' },
      { user: { login }, state: 'PENDING', submitted_at: null },
    ]
    stubLogin()
    ctx.commands.on(['gh', 'api', `${pullEndpoint}/reviews`], { stdout: JSON.stringify(reviews) })
    const client = await createGhReviewStateClient(ctx)

    expect(await client.latestMyReviewState(pullRequest)).toBe(latestState)
  })

  test('latestMyReviewState is null when I have not reviewed', async () => {
    stubLogin()
    ctx.commands.on(['gh', 'api', `${pullEndpoint}/reviews`], { stdout: '[]' })
    const client = await createGhReviewStateClient(ctx)

    expect(await client.latestMyReviewState(pullRequest)).toBeNull()
  })
})
