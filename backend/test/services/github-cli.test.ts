import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { pullRequests, reviewComments, reviewIterations } from '../../src/db/schema'
import { findPullRequestUnscoped } from '../../src/models/pull-request'
import { findReviewTask } from '../../src/models/review-task'
import { SettingStore } from '../../src/models/setting'
import { createGithubCli, fetchLatestForRepo, PR_FETCH_LIMIT, type GithubCli } from '../../src/services/github-cli'
import { GithubCliError, type GithubCliClient } from '../../src/services/github-cli-client'
import type { ListedPullRequest } from '../../src/services/sync/pull-request-attributes'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest, insertReviewComment, insertReviewTask } from '../support/factories'
import { createGitRepository, createTempFolder } from '../support/git'
import { fixtureRepo, fixtureSlug, ghJson, ghListedPullRequest } from '../support/github-fixtures'

const username = 'testuser'
const repoOwner = 'testowner'
const repoName = 'testrepo'
const repoSlug = `${repoOwner}/${repoName}`
const pendingReview = 'pending_review'
const reviewedByMe = 'reviewed_by_me'
const reviewedByOthers = 'reviewed_by_others'
const succeeded = 'succeeded'

function listed(overrides: Partial<ListedPullRequest> & { github_id: bigint }): ListedPullRequest {
  return {
    number: null,
    title: null,
    description: null,
    url: null,
    repo_owner: null,
    repo_name: null,
    author: null,
    author_avatar: null,
    created_at_github: null,
    updated_at_github: null,
    additions: null,
    deletions: null,
    changed_files: null,
    review_requested_for_me: false,
    ...overrides,
  }
}

describe('GithubCli (GithubCliService)', () => {
  const tempFolder = createTempFolder()
  const missingRepoPath = join(tempFolder.path, 'missing-repo')
  let existingDir: string
  let ctx: TestContext
  let cli: GithubCli

  beforeAll(() => {
    existingDir = join(tempFolder.path, 'checkout')
    mkdirSync(existingDir)
  })

  afterAll(() => tempFolder.remove())

  beforeEach(async () => {
    ctx = createTestContext()
    cli = await createGithubCli(ctx, { username, repoPath: missingRepoPath })
  })

  function cliFor(repoPath: string | null, login = username) {
    return createGithubCli(ctx, { username: login, repoPath })
  }

  function pullRequestInRepo(number: number, attributes: Parameters<typeof insertPullRequest>[1] = {}) {
    return insertPullRequest(ctx.db, { githubId: number, number, repoOwner, repoName, ...attributes })
  }

  describe('parsePrs', () => {
    const json = (fields: Record<string, unknown>) => ghJson([ghListedPullRequest({ number: 123, slug: repoSlug, ...fields })])

    test('handles a missing URL', () => {
      const [pr] = cli.parsePrs(json({ url: null }), 'pending_review')

      expect(pr?.url).toBeNull()
      expect(pr?.repo_owner).toBe(repoOwner)
      expect(pr?.repo_name).toBeNull()
    })

    test('handles a missing author', () => {
      const [pr] = cli.parsePrs(json({ author: null }), 'pending_review')

      expect(pr?.author).toBeNull()
      expect(pr?.author_avatar).toBeNull()
    })

    test('handles a missing headRepositoryOwner', () => {
      const [pr] = cli.parsePrs(json({ headRepositoryOwner: null }), 'pending_review')

      expect(pr?.repo_owner).toBe(repoOwner)
      expect(pr?.repo_name).toBe(repoName)
    })

    test.each(['[]', '   '])('returns an empty array for %p', (payload) => {
      expect(cli.parsePrs(payload, 'pending_review')).toEqual([])
    })

    test('sets the requested review status', () => {
      const reviewStatus = 'reviewed_by_me'

      const [pr] = cli.parsePrs(json({}), reviewStatus)

      expect(pr?.review_status).toBe(reviewStatus)
      expect(pr?.review_requested_for_me).toBe(false)
    })

    test('extracts a stable github_id from owner/repo/number', () => {
      const expectedId = BigInt(`0x${createHash('sha256').update(`${repoSlug}/123`).digest('hex')}`) % 2n ** 62n

      const [pr] = cli.parsePrs(json({}), 'pending_review')

      expect(pr?.github_id).toBe(expectedId)
    })

    test('parses all fields', () => {
      const payload = ghListedPullRequest({ number: 123, slug: repoSlug })

      const [pr] = cli.parsePrs(ghJson([payload]), 'pending_review')

      expect(pr).toEqual({
        github_id: cli.extractGithubId(payload.url),
        number: payload.number,
        title: payload.title,
        description: payload.body,
        url: payload.url,
        repo_owner: repoOwner,
        repo_name: repoName,
        author: payload.author.login,
        author_avatar: payload.author.avatarUrl,
        created_at_github: payload.createdAt,
        updated_at_github: payload.updatedAt,
        additions: payload.additions,
        deletions: payload.deletions,
        changed_files: payload.changedFiles,
        review_requested_for_me: true,
        review_status: pendingReview,
      })
    })
  })

  describe('fetch lists', () => {
    test('prioritizes review requests over reviewed_by_me', async () => {
      const reviewRequested = listed({ github_id: 123n, number: 123, title: 'Requested again', review_status: pendingReview, review_requested_for_me: true })
      const reviewed = listed({ github_id: 123n, number: 123, title: 'Previously reviewed', review_status: reviewedByMe })
      spyOn(cli, 'fetchReviewRequests').mockResolvedValue([reviewRequested])
      spyOn(cli, 'fetchOpenPullRequestsWithMetadata').mockResolvedValue({ prs: [reviewRequested], complete: true })
      spyOn(cli, 'fetchReviewedByMe').mockResolvedValue([reviewed])

      const result = await cli.fetchAllPrsNeedingAttention()

      expect(result.pending_review).toEqual([reviewRequested])
      expect(result.reviewed_by_me).toEqual([])
      expect(result.open_prs_complete).toBe(true)
    })

    test('includes every open PR, keeps re-requested ones pending and the rest reviewed', async () => {
      const requested = listed({ github_id: 10n, number: 10, review_status: pendingReview, review_requested_for_me: true })
      const openUnrequested = listed({ github_id: 20n, number: 20, review_status: pendingReview })
      const reviewed = listed({ github_id: 30n, number: 30, review_status: reviewedByMe })
      const rerequested = listed({ github_id: 40n, number: 40, review_status: pendingReview, review_requested_for_me: true })
      const reviewedAndRerequested = listed({ github_id: 40n, number: 40, review_status: reviewedByMe })
      spyOn(cli, 'fetchReviewRequests').mockResolvedValue([requested, rerequested])
      spyOn(cli, 'fetchOpenPullRequestsWithMetadata').mockResolvedValue({ prs: [requested, openUnrequested, reviewed, rerequested], complete: true })
      spyOn(cli, 'fetchReviewedByMe').mockResolvedValue([reviewed, reviewedAndRerequested])

      const result = await cli.fetchAllPrsNeedingAttention()

      expect(result.pending_review).toEqual([requested, openUnrequested, rerequested])
      expect(result.reviewed_by_me).toEqual([reviewed])
    })

    test('runs the three gh searches and reports truncated open lists', async () => {
      const requested = ghListedPullRequest({ number: 1 })
      const reviewed = ghListedPullRequest({ number: 2 })
      const openPrs = Array.from({ length: PR_FETCH_LIMIT }, (_, index) => ghListedPullRequest({ number: index + 1 }))
      ctx.commands.on(['gh', 'pr', 'list', '--search', 'review-requested:@me'], { stdout: ghJson([requested]) })
      ctx.commands.on(['gh', 'pr', 'list', '--search', 'reviewed-by:@me'], { stdout: ghJson([reviewed]) })
      ctx.commands.on(['gh', 'pr', 'list', '--state', 'open'], { stdout: ghJson(openPrs) })

      const result = await cli.fetchAllPrsNeedingAttention()

      expect(ctx.commands.calls.map(({ command }) => command)).toEqual([
        ['gh', 'pr', 'list', '--search', 'review-requested:@me', '--json', cli.prFields(), '--limit', String(PR_FETCH_LIMIT)],
        ['gh', 'pr', 'list', '--search', 'reviewed-by:@me', '--json', cli.prFields(), '--limit', String(PR_FETCH_LIMIT)],
        ['gh', 'pr', 'list', '--state', 'open', '--json', cli.prFields(), '--limit', String(PR_FETCH_LIMIT)],
      ])
      expect(result.open_prs_complete).toBe(false)
      expect(result.pending_review.filter((pr) => pr.review_requested_for_me).map((pr) => pr.number)).toEqual([requested.number])
      expect(result.pending_review).toHaveLength(openPrs.length - 1)
      expect(result.reviewed_by_me.map((pr) => pr.number)).toEqual([reviewed.number])
    })

    test('fetchOpenPullRequests returns the prs of the metadata response', async () => {
      const prs = [listed({ github_id: 1n, number: 1 })]
      spyOn(cli, 'fetchOpenPullRequestsWithMetadata').mockResolvedValue({ prs, complete: true })

      expect(await cli.fetchOpenPullRequests()).toEqual(prs)
    })
  })

  describe('createGithubCli', () => {
    test('stores the github login in settings', async () => {
      const login = 'login_user'

      const created = await cliFor(missingRepoPath, login)

      expect(new SettingStore(ctx.db).githubLogin()).toBe(login)
      expect(created.username).toBe(login)
    })

    test('fetches the current user, outside any checkout, when the username is missing', async () => {
      const fetchedUser = 'fetched_user'
      ctx.commands.on(['gh', 'api', 'user', '--jq', '.login'], { stdout: `${fetchedUser}\n` })

      const created = await createGithubCli(ctx, { repoPath: existingDir })

      expect(created.username).toBe(fetchedUser)
      expect(new SettingStore(ctx.db).githubLogin()).toBe(fetchedUser)
      expect(ctx.commands.calls[0]?.options.cwd).toBeUndefined()
    })

    test('does not persist a blank github login', async () => {
      const existingLogin = 'existing_user'
      new SettingStore(ctx.db).setGithubLogin(existingLogin)

      await cliFor(missingRepoPath, '')

      expect(new SettingStore(ctx.db).githubLogin()).toBe(existingLogin)
    })

    test('defaults the repo path to the current repo setting', async () => {
      new SettingStore(ctx.db).setCurrentRepo(existingDir)

      const created = await createGithubCli(ctx, { username })

      expect(created.repoPath).toBe(existingDir)
    })

    test('raises GithubCliError when gh cannot tell who the user is', async () => {
      ctx.commands.on(['gh', 'api', 'user'], { stderr: 'not logged in', exitCode: 1 })

      await expect(createGithubCli(ctx, {})).rejects.toThrow(GithubCliError)
    })
  })

  describe('syncToDatabase', () => {
    let repoPath: string

    beforeAll(async () => {
      repoPath = await createGitRepository(tempFolder.path, fixtureRepo, fixtureSlug)
    })

    test('delegates to the sync engine for the service repo', async () => {
      const number = 5
      ctx.commands.on(['gh', 'pr', 'list'], { stdout: ghJson([ghListedPullRequest({ number })]) })
      const service = await cliFor(repoPath)

      const result = await service.syncToDatabase()

      expect(result).toMatchObject({ created: 1, already_running: false, sync: { status: succeeded } })
      expect(ctx.commands.commandsMatching(['gh', 'pr', 'list'])[0]?.options.cwd).toBe(repoPath)
    })

    test('wraps sync adapter errors', async () => {
      const message = 'boom'
      ctx.commands.on(['gh', 'pr', 'list'], { stderr: message, exitCode: 1 })
      const service = await cliFor(repoPath)

      await expect(service.syncToDatabase()).rejects.toThrow(new GithubCliError(message))
    })

    test('wraps database errors', async () => {
      ctx.commands.on(['gh', 'pr', 'list'], { stdout: ghJson([ghListedPullRequest({ number: 6, title: null })]) })
      const service = await cliFor(repoPath)

      const failure = service.syncToDatabase()

      await expect(failure).rejects.toThrow(GithubCliError)
      await expect(failure).rejects.toThrow(/Title can't be blank/)
    })
  })

  describe('syncPrs', () => {
    test('reuses an archived PR record instead of creating a duplicate github_id', () => {
      const archived = pullRequestInRepo(777, { githubId: 9101, title: 'Old archived', archived: true })
      const now = new Date().toISOString()
      const incoming = {
        github_id: 9101n,
        number: 777,
        title: 'Reopened',
        description: 'Back again',
        url: archived.url,
        repo_owner: repoOwner,
        repo_name: repoName,
        author: 'author',
        author_avatar: null,
        created_at_github: now,
        updated_at_github: now,
        review_status: pendingReview,
      }

      cli.syncPrs([incoming], pendingReview)

      const reloaded = findPullRequestUnscoped(ctx.db, archived.id)
      expect(ctx.db.select().from(pullRequests).all()).toHaveLength(1)
      expect(reloaded?.archived).toBe(false)
      expect(reloaded?.deletedAt).toBeNull()
      expect(reloaded?.title).toBe(incoming.title)
    })

    test('resets a completed task to pending_review when review is requested again', () => {
      const pullRequest = pullRequestInRepo(222, { title: 'Needs re-review', reviewStatus: 'waiting_implementation' })
      const hour = 60 * 60 * 1000
      const task = insertReviewTask(ctx.db, {
        pullRequestId: pullRequest.id,
        state: 'waiting_implementation',
        reviewOutput: 'Old review output',
        startedAt: new Date(Date.now() - 2 * hour),
        completedAt: new Date(Date.now() - hour),
        submissionStatus: 'submitted',
        submittedAt: new Date(Date.now() - hour / 2),
      })
      insertReviewComment(ctx.db, { reviewTaskId: task.id, body: 'Old comment', filePath: 'app/models/user.rb', severity: 'major' })
      const now = new Date().toISOString()

      cli.syncPrs(
        [
          {
            github_id: BigInt(pullRequest.githubId ?? 0),
            number: pullRequest.number,
            title: 'Needs re-review (updated)',
            description: 'Updated body',
            url: pullRequest.url,
            repo_owner: repoOwner,
            repo_name: repoName,
            author: 'author',
            author_avatar: 'https://example.com/a.png',
            created_at_github: now,
            updated_at_github: now,
            review_status: pendingReview,
          },
        ],
        pendingReview,
      )

      const pendingSubmission = 'pending_submission'
      const reloadedTask = findReviewTask(ctx.db, task.id)
      const iterations = ctx.db.select().from(reviewIterations).where(eq(reviewIterations.reviewTaskId, task.id)).all()
      expect(findPullRequestUnscoped(ctx.db, pullRequest.id)?.reviewStatus).toBe(pendingReview)
      expect(reloadedTask.state).toBe(pendingReview)
      expect(reloadedTask.reviewOutput).toBeNull()
      expect(reloadedTask.submissionStatus).toBe(pendingSubmission)
      expect(reloadedTask.submittedAt).toBeNull()
      expect(ctx.db.select().from(reviewComments).where(eq(reviewComments.reviewTaskId, task.id)).all()).toEqual([])
      expect(iterations.map((iteration) => iteration.fromState)).toEqual([task.state])
    })

    test('keeps a task-backed PR status and demotes reviewed_by_me without a task', () => {
      const withTask = pullRequestInRepo(1, { reviewStatus: 'in_review' })
      insertReviewTask(ctx.db, { pullRequestId: withTask.id, state: 'in_review' })

      cli.syncPrs(
        [
          { github_id: 1n, number: 1, title: 'Renamed', url: withTask.url, repo_owner: repoOwner, repo_name: repoName, review_status: pendingReview },
          { github_id: 2n, number: 2, title: 'New', url: 'https://github.com/testowner/testrepo/pull/2', repo_owner: repoOwner, repo_name: repoName, review_status: reviewedByMe },
        ],
        'pending_review',
      )

      const created = ctx.db.select().from(pullRequests).where(eq(pullRequests.number, 2)).get()
      expect(findPullRequestUnscoped(ctx.db, withTask.id)).toMatchObject({ title: 'Renamed', reviewStatus: withTask.reviewStatus })
      expect(created?.reviewStatus).toBe(pendingReview)
    })
  })

  describe('getRepoInfo', () => {
    test.each([null, 'missing'])('returns null for repo path %p', async (repoPath) => {
      const service = await cliFor(repoPath === null ? null : missingRepoPath)

      expect(await service.getRepoInfo()).toBeNull()
      expect(ctx.commands.calls).toEqual([])
    })

    const remoteOwner = 'acme'
    const remoteName = 'widgets'

    test.each([`https://github.com/${remoteOwner}/${remoteName}.git\n`, `git@github.com:${remoteOwner}/${remoteName}.git\n`])('parses the %p remote', async (remote) => {
      ctx.commands.on(['git', '-C'], { stdout: remote })
      const service = await cliFor(existingDir)

      expect(await service.getRepoInfo()).toEqual({ owner: remoteOwner, name: remoteName })
      expect(ctx.commands.calls[0]?.command).toEqual(['git', '-C', realpathSync(existingDir), 'remote', 'get-url', 'origin'])
    })

    test.each([
      ['git fails', { stdout: '', exitCode: 1 }],
      ['the remote is empty', { stdout: '\n' }],
      ['the remote is not on GitHub', { stdout: 'git@example.com:acme/widgets.git\n' }],
    ])('returns null when %s', async (_, response) => {
      ctx.commands.on(['git', '-C'], response)
      const service = await cliFor(existingDir)

      expect(await service.getRepoInfo()).toBeNull()
    })

    test('returns null when running git raises', async () => {
      ctx.commands.on(['git', '-C'], () => {
        throw new Error('spawn failed')
      })
      const service = await cliFor(existingDir)

      expect(await service.getRepoInfo()).toBeNull()
    })
  })

  describe('removeStalePrs', () => {
    function stubRemote() {
      ctx.commands.on(['git', '-C'], { stdout: `git@github.com:${repoSlug}.git\n` })
    }

    test('soft-deletes stale records instead of destroying review data', async () => {
      stubRemote()
      const stale = pullRequestInRepo(9201)
      const service = await cliFor(existingDir)

      await service.removeStalePrs({ pending_review: [], reviewed_by_me: [] })

      const reloaded = findPullRequestUnscoped(ctx.db, stale.id)
      expect(reloaded?.deletedAt).toBeInstanceOf(Date)
    })

    test('is a no-op without a repo path', async () => {
      const kept = pullRequestInRepo(111)
      const service = await cliFor(null)

      await service.removeStalePrs({ pending_review: [], reviewed_by_me: [] })

      expect(findPullRequestUnscoped(ctx.db, kept.id)?.deletedAt).toBeNull()
    })

    test('is a no-op when the repo info cannot be resolved', async () => {
      ctx.commands.on(['git', '-C'], { exitCode: 1 })
      const kept = pullRequestInRepo(112)
      const service = await cliFor(existingDir)

      await service.removeStalePrs({ pending_review: [], reviewed_by_me: [] })

      expect(findPullRequestUnscoped(ctx.db, kept.id)?.deletedAt).toBeNull()
    })

    test('leaves fetched and other-repo PRs alone', async () => {
      stubRemote()
      const fetched = pullRequestInRepo(113)
      const otherRepo = insertPullRequest(ctx.db, { githubId: 114, number: 114, repoOwner: 'elsewhere' })
      const service = await cliFor(existingDir)

      await service.removeStalePrs({ pending_review: [{ github_id: 113n }], reviewed_by_me: [] })

      expect(findPullRequestUnscoped(ctx.db, fetched.id)?.deletedAt).toBeNull()
      expect(findPullRequestUnscoped(ctx.db, otherRepo.id)?.deletedAt).toBeNull()
    })
  })

  describe('fetchLatestForRepo', () => {
    test.each([null, 'missing'])('is a no-op for repo path %p', async (repoPath) => {
      await fetchLatestForRepo(ctx, repoPath === null ? null : missingRepoPath)

      expect(ctx.commands.calls).toEqual([])
    })

    test('fetches and fast-forwards an existing checkout', async () => {
      ctx.commands.on(['git'], { stdout: '' })

      await fetchLatestForRepo(ctx, existingDir)

      expect(ctx.commands.calls.map(({ command }) => command)).toEqual([
        ['git', '-C', existingDir, 'fetch', 'origin'],
        ['git', '-C', existingDir, 'pull', '--ff-only'],
      ])
    })

    test('raises when git fetch fails', async () => {
      const stderr = 'fatal: failed'
      ctx.commands.on(['git'], { stderr, exitCode: 1 })

      await expect(fetchLatestForRepo(ctx, existingDir)).rejects.toThrow(new GithubCliError(`git fetch failed: ${stderr}`))
    })

    test('raises when git pull fails after a successful fetch', async () => {
      const stderr = 'pull failed'
      ctx.commands.on(['git', '-C', existingDir, 'fetch'], { stdout: 'ok' })
      ctx.commands.on(['git', '-C', existingDir, 'pull'], { stderr, exitCode: 1 })

      await expect(fetchLatestForRepo(ctx, existingDir)).rejects.toThrow(`git pull failed: ${stderr}`)
    })

    test('falls back to stdout, then "unknown error"', async () => {
      const stdout = '  diverged  '
      ctx.commands.on(['git', '-C', existingDir, 'fetch'], { stdout, exitCode: 1 })

      await expect(fetchLatestForRepo(ctx, existingDir)).rejects.toThrow(`git fetch failed: ${stdout.trim()}`)

      const silent = createTestContext()
      silent.commands.on(['git'], { exitCode: 1 })
      await expect(fetchLatestForRepo(silent, existingDir)).rejects.toThrow('git fetch failed: unknown error')
    })
  })

  describe('markReviewedByOthers', () => {
    test('returns early without calling gh when no PR is pending', async () => {
      expect(await cli.markReviewedByOthers()).toBeUndefined()
      expect(ctx.commands.calls).toEqual([])
    })

    test('skips when requested-only reviews are disabled', async () => {
      new SettingStore(ctx.db).setOnlyRequestedReviews(false)
      pullRequestInRepo(4000)

      await cli.markReviewedByOthers()

      expect(ctx.commands.calls).toEqual([])
    })

    test('updates only unrequested pending PRs without tasks', async () => {
      const requested = pullRequestInRepo(4001)
      const unrequested = pullRequestInRepo(4002)
      const taskBacked = pullRequestInRepo(4003)
      insertReviewTask(ctx.db, { pullRequestId: taskBacked.id, state: 'pending_review' })
      ctx.commands.on(['gh', 'pr', 'list'], {
        stdout: ghJson([
          { number: requested.number, state: 'OPEN', reviewRequests: [{ login: username }] },
          { number: unrequested.number, state: 'OPEN', reviewRequests: [] },
          { number: taskBacked.number, state: 'OPEN', reviewRequests: [] },
        ]),
      })

      await cli.markReviewedByOthers()

      expect(ctx.commands.calls[0]?.command).toEqual(['gh', 'pr', 'list', '--json', 'number,state,reviewRequests', '--limit', String(PR_FETCH_LIMIT)])
      expect(findPullRequestUnscoped(ctx.db, requested.id)?.reviewStatus).toBe(pendingReview)
      expect(findPullRequestUnscoped(ctx.db, unrequested.id)?.reviewStatus).toBe(reviewedByOthers)
      expect(findPullRequestUnscoped(ctx.db, taskBacked.id)?.reviewStatus).toBe(pendingReview)
    })
  })

  describe('GithubCliClient methods', () => {
    test('latestMyReviewState returns the newest submitted state of the current user', async () => {
      const pullRequest = pullRequestInRepo(333)
      const newestState = 'CHANGES_REQUESTED'
      ctx.commands.on(['gh', 'api'], {
        stdout: ghJson([
          { user: { login: 'other' }, state: 'APPROVED', submitted_at: '2026-02-24T00:00:00Z' },
          { user: { login: username }, state: newestState, submitted_at: '2026-02-24T02:00:00Z' },
          { user: { login: username }, state: 'COMMENTED', submitted_at: '2026-02-24T01:00:00Z' },
        ]),
      })

      expect(await cli.latestMyReviewState(pullRequest)).toBe(newestState)
      expect(ctx.commands.calls[0]?.command).toEqual(['gh', 'api', `/repos/${repoSlug}/pulls/${pullRequest.number}/reviews`])
    })

    test('latestMyReviewState returns null without submitted reviews from the current user', async () => {
      const pullRequest = pullRequestInRepo(335)
      ctx.commands.on(['gh', 'api'], {
        stdout: ghJson([
          { user: { login: 'other' }, state: 'APPROVED', submitted_at: '2026-02-24T00:00:00Z' },
          { user: { login: username }, state: 'COMMENTED', submitted_at: null },
        ]),
      })

      expect(await cli.latestMyReviewState(pullRequest)).toBeNull()
    })

    test('reviewRequestedForMe detects the current user among requested reviewers', async () => {
      const pullRequest = pullRequestInRepo(334)
      ctx.commands.on(['gh', 'api'], { stdout: ghJson({ requested_reviewers: [{ login: 'other' }, { login: username }] }) })

      expect(await cli.reviewRequestedForMe(pullRequest)).toBe(true)
      expect(ctx.commands.calls[0]?.command).toEqual(['gh', 'api', `/repos/${repoSlug}/pulls/${pullRequest.number}`])
    })

    test('reviewRequestedForMe is false when requested_reviewers is missing', async () => {
      const pullRequest = pullRequestInRepo(336)
      ctx.commands.on(['gh', 'api'], { stdout: ghJson({}) })

      expect(await cli.reviewRequestedForMe(pullRequest)).toBe(false)
    })

    test('fetchPrComments maps review comments', async () => {
      const pullRequest = pullRequestInRepo(337)
      const comment = { body: 'Nit', user: { login: 'reviewer' }, created_at: '2026-02-24T00:00:00Z', path: 'app.rb', line: 4 }
      ctx.commands.on(['gh', 'api'], { stdout: ghJson([comment]) })

      const comments = await cli.fetchPrComments(pullRequest)

      expect(comments).toEqual([{ body: comment.body, author: comment.user.login, created_at: comment.created_at, path: comment.path, line: comment.line }])
      expect(ctx.commands.calls[0]?.command).toEqual(['gh', 'api', `/repos/${repoSlug}/pulls/${pullRequest.number}/comments`])
    })

    test.each([' \n', 'not json'])('fetchPrComments returns [] for %p', async (stdout) => {
      ctx.commands.on(['gh', 'api'], { stdout })

      expect(await cli.fetchPrComments(pullRequestInRepo(338))).toEqual([])
    })

    test('satisfies the GithubCliClient interface', () => {
      const client: GithubCliClient = cli

      expect(typeof client.fetchPrComments).toBe('function')
    })
  })

  describe('helpers', () => {
    test('extractGithubId is stable and positive', () => {
      const url = `https://github.com/${repoSlug}/pull/123`

      const id = cli.extractGithubId(url)

      expect(cli.extractGithubId(url)).toBe(id)
      expect(id > 0n).toBe(true)
    })

    test('extractGithubId hashes non-GitHub URLs whole', () => {
      const url = 'not-a-github-url'
      const expectedId = BigInt(`0x${createHash('sha256').update(url).digest('hex')}`) % 2n ** 62n

      expect(cli.extractGithubId(url)).toBe(expectedId)
    })

    test('prFields lists the fields the parser reads', () => {
      const fields = cli.prFields().split(',')

      expect(fields).toEqual(expect.arrayContaining(['number', 'title', 'url', 'author', 'headRepositoryOwner', 'createdAt', 'updatedAt']))
    })

    test('runGhCommand raises on CLI failure', async () => {
      const stderr = 'boom'
      ctx.commands.on(['gh', 'pr', 'list'], { stderr, exitCode: 1 })

      await expect(cli.runGhCommand(['pr', 'list'])).rejects.toThrow(new GithubCliError(`GitHub CLI error: ${stderr}`))
      expect(ctx.commands.calls[0]?.options.cwd).toBeUndefined()
    })

    test('runGhCommand passes the timeout and runs inside an existing repo path', async () => {
      const stdout = 'ok'
      const timeoutSeconds = 5
      ctx.commands.on(['gh', 'api', 'user'], { stdout })
      const service = await cliFor(existingDir)

      expect(await service.runGhCommand(['api', 'user'], { timeout: timeoutSeconds })).toBe(stdout)
      expect(ctx.commands.calls[0]?.options).toEqual({ cwd: existingDir, timeoutMs: timeoutSeconds * 1000 })
    })

    test('shouldReconcileStalePrs needs a repo path and a complete open list', async () => {
      const withoutRepo = await cliFor(null)

      expect(cli.shouldReconcileStalePrs({ open_prs_complete: true })).toBe(true)
      expect(cli.shouldReconcileStalePrs({ open_prs_complete: false })).toBe(false)
      expect(withoutRepo.shouldReconcileStalePrs({ open_prs_complete: true })).toBe(false)
    })
  })
})
