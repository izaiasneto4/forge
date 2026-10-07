import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SettingStore } from '../../../src/models/setting'
import { isSyncModeActive, withSyncMode } from '../../../src/services/sync-mode'
import { runOrchestratedSync } from '../../../src/services/sync/orchestrator'
import { createTestContext } from '../../support/context'
import { createCheckoutFolder, stubGitRepository, createTempFolder } from '../../support/git'
import { fixtureRepo, fixtureSlug, ghJson } from '../../support/github-fixtures'

describe('runOrchestratedSync (Sync::Orchestrator)', () => {
  const tempFolder = createTempFolder()
  let repoPath: string

  beforeAll(async () => {
    repoPath = createCheckoutFolder(tempFolder.path, fixtureRepo)
  })

  afterAll(() => tempFolder.remove())

  test('runs the sync engine for the current repo inside sync mode', async () => {
    const ctx = createTestContext()
    stubGitRepository(ctx.commands, repoPath, fixtureSlug)
    const settings = new SettingStore(ctx.db)
    settings.setCurrentRepo(repoPath)
    settings.setGithubLogin('izaias')
    const succeeded = 'succeeded'
    const syncModeDuringFetch: boolean[] = []
    ctx.commands.on(['gh', 'pr', 'list'], () => {
      syncModeDuringFetch.push(isSyncModeActive())
      return { stdout: ghJson([]) }
    })

    const result = await runOrchestratedSync(ctx)

    expect(result).toMatchObject({ fetched: 0, already_running: false, sync: { status: succeeded } })
    expect(syncModeDuringFetch).toEqual([true])
    expect(isSyncModeActive()).toBe(false)
  })
})

// test/services/sync_mode_test.rb
describe('withSyncMode', () => {
  test('is inactive by default', () => {
    expect(isSyncModeActive()).toBe(false)
  })

  test('enables the flag during the block only', () => {
    const observed = withSyncMode(() => isSyncModeActive())

    expect(observed).toBe(true)
    expect(isSyncModeActive()).toBe(false)
  })

  test('restores the previous state after an exception', () => {
    const message = 'boom'

    expect(() =>
      withSyncMode(() => {
        throw new Error(message)
      }),
    ).toThrow(message)
    expect(isSyncModeActive()).toBe(false)
  })

  test('preserves nested state', () => {
    const observed = withSyncMode(() => {
      const outer = isSyncModeActive()
      const inner = withSyncMode(() => isSyncModeActive())
      return { outer, inner, afterInner: isSyncModeActive() }
    })

    expect(observed).toEqual({ outer: true, inner: true, afterInner: true })
    expect(isSyncModeActive()).toBe(false)
  })

  test('stays active across awaits inside the block', async () => {
    const observed = await withSyncMode(async () => {
      await Bun.sleep(1)
      return isSyncModeActive()
    })

    expect(observed).toBe(true)
    expect(isSyncModeActive()).toBe(false)
  })
})
