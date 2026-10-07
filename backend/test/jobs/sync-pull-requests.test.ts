import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { syncPullRequestsJob } from '../../src/jobs/handlers/sync-pull-requests'
import { SettingStore } from '../../src/models/setting'
import { STREAMS } from '../../src/realtime/broadcaster'
import { SyncAdapterError } from '../../src/services/sync/github-adapter'
import { createTestContext, type TestContext } from '../support/context'
import { createCheckoutFolder, stubGitRepository, createTempFolder } from '../support/git'
import { fixtureRepo, fixtureSlug, ghJson } from '../support/github-fixtures'

describe('syncPullRequestsJob (SyncPullRequestsJob)', () => {
  const tempFolder = createTempFolder()
  let repoPath: string
  let ctx: TestContext

  beforeAll(async () => {
    repoPath = createCheckoutFolder(tempFolder.path, fixtureRepo)
  })

  afterAll(() => tempFolder.remove())

  beforeEach(() => {
    ctx = createTestContext()
    stubGitRepository(ctx.commands, repoPath, fixtureSlug)
    const settings = new SettingStore(ctx.db)
    settings.setCurrentRepo(repoPath)
    settings.setGithubLogin('izaias')
  })

  test('syncs the current repo with the job trigger', async () => {
    const trigger = 'job'
    ctx.commands.on(['gh', 'pr', 'list'], { stdout: ghJson([]) })

    await syncPullRequestsJob(ctx)

    const started = ctx.events.on(STREAMS.uiEvents).find((message) => message.event === 'sync.started')
    expect(started).toMatchObject({ repo_path: repoPath, sync: { trigger } })
    expect(ctx.commands.commandsMatching(['gh'])[0]?.options.cwd).toBe(repoPath)
  })

  test('re-raises sync engine errors', async () => {
    const message = 'Network error'
    ctx.commands.on(['gh', 'pr', 'list'], { stderr: message, exitCode: 1 })

    const failure = syncPullRequestsJob(ctx)

    await expect(failure).rejects.toBeInstanceOf(SyncAdapterError)
    await expect(failure).rejects.toThrow(message)
  })
})
