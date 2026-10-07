import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createGithubAdapter, PR_FETCH_LIMIT, PR_FIELDS, SyncAdapterError } from '../../../src/services/sync/github-adapter'
import { createTestContext, type TestContext } from '../../support/context'
import { createCheckoutFolder, stubGitRepository, createTempFolder } from '../../support/git'
import { fixtureOwner, fixtureRepo, fixtureSlug, ghJson, ghPullRequest, githubIdFor, pullRequestUrl } from '../../support/github-fixtures'

describe('GithubAdapter (Sync::GithubAdapter)', () => {
  const tempFolder = createTempFolder()
  const login = 'izaias'
  let repoPath: string
  let ctx: TestContext

  beforeAll(async () => {
    repoPath = createCheckoutFolder(tempFolder.path, fixtureRepo)
  })

  afterAll(() => tempFolder.remove())

  beforeEach(() => {
    ctx = createTestContext()
    stubGitRepository(ctx.commands, repoPath, fixtureSlug)
  })

  function adapter() {
    return createGithubAdapter(ctx, { repoPath, githubLogin: login })
  }

  describe('construction', () => {
    test('resolves the repo slug and keeps the given login without calling gh', async () => {
      const built = await adapter()

      expect(built.repoSlug).toBe(fixtureSlug)
      expect(built.githubLogin).toBe(login)
      expect(ctx.commands.commandsMatching(['gh'])).toEqual([])
    })

    test('asks gh for the login, inside the checkout, when none is known', async () => {
      const fetchedLogin = 'octocat'
      ctx.commands.on(['gh', 'api', 'user', '--jq', '.login'], { stdout: `${fetchedLogin}\n` })

      const built = await createGithubAdapter(ctx, { repoPath, githubLogin: '  ' })

      expect(built.githubLogin).toBe(fetchedLogin)
      expect(ctx.commands.commandsMatching(['gh'])[0]?.options.cwd).toBe(repoPath)
    })
  })

  describe('fetchOpenPullRequests', () => {
    test('lists open PRs with the adapter fields and parses every attribute', async () => {
      const number = 12
      const headSha = 'abc123'
      const baseSha = 'def456'
      const payload = ghPullRequest({ number, headRefOid: headSha, baseRefOid: baseSha, isDraft: true, reviewDecision: 'APPROVED' })
      ctx.commands.on(['gh', 'pr', 'list'], { stdout: ghJson([payload]) })

      const fetched = await (await adapter()).fetchOpenPullRequests()

      expect(ctx.commands.commandsMatching(['gh'])[0]?.command).toEqual(['gh', 'pr', 'list', '--state', 'open', '--json', PR_FIELDS.join(','), '--limit', String(PR_FETCH_LIMIT)])
      expect(ctx.commands.commandsMatching(['gh'])[0]?.options.cwd).toBe(repoPath)
      expect(fetched.complete).toBe(true)
      expect(fetched.prs).toEqual([
        {
          github_id: githubIdFor(number),
          number,
          title: payload.title,
          description: payload.body,
          url: pullRequestUrl(number),
          repo_owner: fixtureOwner,
          repo_name: fixtureRepo,
          author: payload.author.login,
          author_avatar: payload.author.avatarUrl,
          created_at_github: payload.createdAt,
          updated_at_github: payload.updatedAt,
          additions: payload.additions,
          deletions: payload.deletions,
          changed_files: payload.changedFiles,
          review_requested_for_me: false,
          remote_state: 'open',
          inactive_reason: null,
          head_sha: headSha,
          base_sha: baseSha,
          head_ref: payload.headRefName,
          base_ref: payload.baseRefName,
          merged_at_github: null,
          closed_at_github: null,
          latest_review_state: null,
          review_decision: 'APPROVED',
          check_status: null,
          draft: true,
        },
      ])
    })

    test('flags the list as incomplete when it hits the fetch limit', async () => {
      const prs = Array.from({ length: PR_FETCH_LIMIT }, (_, index) => ghPullRequest({ number: index + 1 }))
      ctx.commands.on(['gh', 'pr', 'list'], { stdout: ghJson(prs) })

      const fetched = await (await adapter()).fetchOpenPullRequests()

      expect(fetched.complete).toBe(false)
      expect(fetched.prs).toHaveLength(PR_FETCH_LIMIT)
    })

    test('treats blank output as an empty, complete list', async () => {
      ctx.commands.on(['gh', 'pr', 'list'], { stdout: '  \n' })

      expect(await (await adapter()).fetchOpenPullRequests()).toEqual({ prs: [], complete: true })
    })

    test('raises parse failures and gh errors as SyncAdapterError', async () => {
      const stderr = 'HTTP 401: Bad credentials'
      const built = await adapter()
      ctx.commands.on(['gh', 'pr', 'list'], { stdout: 'not json' })
      await expect(built.fetchOpenPullRequests()).rejects.toThrow(/^GitHub response parse failed: /)

      const failing = createTestContext()
      failing.commands.on(['gh', 'pr', 'list'], { stderr, exitCode: 1 })
      const failingAdapter = await createGithubAdapter(failing, { repoPath, githubLogin: login })
      await expect(failingAdapter.fetchOpenPullRequests()).rejects.toThrow(new SyncAdapterError(stderr))
    })

    test('falls back to stdout, then a generic message, for failing gh calls', async () => {
      const stdout = 'something went wrong'
      ctx.commands.on(['gh', 'pr', 'list', '--state'], { stdout, stderr: ' ', exitCode: 1 })
      const built = await adapter()

      await expect(built.fetchOpenPullRequests()).rejects.toThrow(stdout)

      const silent = createTestContext()
      silent.commands.on(['gh'], { exitCode: 1 })
      const silentAdapter = await createGithubAdapter(silent, { repoPath, githubLogin: login })
      await expect(silentAdapter.fetchOpenPullRequests()).rejects.toThrow('GitHub CLI error')
    })
  })

  describe('parsePullRequest', () => {
    test.each([
      [{ state: 'MERGED' }, 'merged'],
      [{ mergedAt: '2026-03-01T00:00:00Z', state: 'CLOSED' }, 'merged'],
      [{ state: 'closed' }, 'closed'],
      [{ closedAt: '2026-03-01T00:00:00Z' }, 'closed'],
      [{ state: 'OPEN', mergedAt: '', closedAt: null }, 'open'],
    ])('derives the remote state from %p', async (fields, remoteState) => {
      const parsed = (await adapter()).parsePullRequest(ghPullRequest({ number: 1, ...fields }))

      expect(parsed.remote_state).toBe(remoteState)
      expect(parsed.inactive_reason).toBe(remoteState === 'open' ? null : remoteState)
    })

    test.each([
      [[{ login: login.toUpperCase() }]],
      [[{ requestedReviewer: { login } }]],
      [[{ requestedReviewer: { user: { login } } }]],
      [[{ login: 'someone' }, { login }]],
    ])('detects a review request for the user in %p', async (reviewRequests) => {
      const parsed = (await adapter()).parsePullRequest(ghPullRequest({ number: 1, reviewRequests }))

      expect(parsed.review_requested_for_me).toBe(true)
    })

    test.each([[[]], [null], [[{ login: 'someone' }]], [[{ name: 'core-team' }]]])('sees no review request in %p', async (reviewRequests) => {
      const parsed = (await adapter()).parsePullRequest(ghPullRequest({ number: 1, reviewRequests }))

      expect(parsed.review_requested_for_me).toBe(false)
    })

    test('takes the last review authored by the user', async () => {
      const latestReviews = [
        { author: { login }, state: 'COMMENTED' },
        { author: { author: { login: login.toUpperCase() } }, state: 'APPROVED' },
        { user: { login: 'someone' }, state: 'CHANGES_REQUESTED' },
      ]

      const parsed = (await adapter()).parsePullRequest(ghPullRequest({ number: 1, latestReviews }))

      expect(parsed.latest_review_state).toBe(latestReviews[1]?.state ?? '')
    })

    test.each([
      [[], null],
      [[{ state: 'SUCCESS' }, { conclusion: 'success' }], 'success'],
      [[{ state: 'SUCCESS' }, { context: { state: 'pending' } }], 'pending'],
      [[{ conclusion: 'IN_PROGRESS' }, { state: 'ERROR' }], 'failure'],
      [[{ status: 'QUEUED' }], null],
      [[{ conclusion: '' }], 'success'],
    ])('summarizes checks %p as %p', async (statusCheckRollup, checkStatus) => {
      const parsed = (await adapter()).parsePullRequest(ghPullRequest({ number: 1, statusCheckRollup }))

      expect(parsed.check_status).toBe(checkStatus)
    })

    test('falls back to the head repository owner for non-PR URLs', async () => {
      const url = 'https://example.com/custom/4'
      const headOwner = 'fallback'

      const parsed = (await adapter()).parsePullRequest(ghPullRequest({ number: 4, url, headRepositoryOwner: { login: headOwner } }))

      expect(parsed).toMatchObject({ url, repo_owner: headOwner, repo_name: null })
    })
  })

  describe('fetchPullRequest', () => {
    test('views one PR by number', async () => {
      const number = 55
      ctx.commands.on(['gh', 'pr', 'view'], { stdout: ghJson(ghPullRequest({ number })) })

      const fetched = await (await adapter()).fetchPullRequest(number)

      expect(ctx.commands.commandsMatching(['gh'])[0]?.command).toEqual(['gh', 'pr', 'view', String(number), '--json', PR_FIELDS.join(',')])
      expect(fetched?.github_id).toBe(githubIdFor(number))
    })

    test.each(['no pull requests found for branch "x"', 'GraphQL: Could not resolve to a PullRequest with the number of 9.'])(
      'returns null when gh says %p',
      async (stderr) => {
        ctx.commands.on(['gh', 'pr', 'view'], { stderr, exitCode: 1 })

        expect(await (await adapter()).fetchPullRequest(9)).toBeNull()
      },
    )

    test('rethrows other gh failures and parse errors', async () => {
      const stderr = 'HTTP 500'
      ctx.commands.on(['gh', 'pr', 'view', '1'], { stderr, exitCode: 1 })
      ctx.commands.on(['gh', 'pr', 'view', '2'], { stdout: '{oops' })
      const built = await adapter()

      await expect(built.fetchPullRequest(1)).rejects.toThrow(new SyncAdapterError(stderr))
      await expect(built.fetchPullRequest(2)).rejects.toThrow(/^GitHub response parse failed: /)
    })
  })
})
