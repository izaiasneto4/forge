import { treaty } from '@elysiajs/eden'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../../src/db/client'
import {
  CLI_CLIENTS,
  DEFAULT_CLI_CLIENT,
  SETTING_KEYS,
  SettingStore,
  VALID_THEME_PREFERENCES,
} from '../../src/models/setting'
import { createTestApp } from '../support/app'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest } from '../support/factories'
import { createGitRepository, createTempFolder } from '../support/git'

describe('GET /api/v1/settings', () => {
  let ctx: TestContext
  let db: Db
  let settingStore: SettingStore
  let reposFolder: ReturnType<typeof createTempFolder>

  beforeEach(() => {
    ctx = createTestContext()
    db = ctx.db
    settingStore = new SettingStore(db)
    reposFolder = createTempFolder()
  })

  afterEach(() => reposFolder.remove())

  async function getSettings() {
    const client = treaty(createTestApp(ctx))
    const { status, data } = await client.api.v1.settings.get()
    return { status, body: data }
  }

  test('returns defaults in the ok envelope when nothing is stored', async () => {
    const { status, body } = await getSettings()

    expect(status).toBe(200)
    expect(body).toEqual({
      repos_folder: null,
      current_repo: { path: null, slug: null, name: null },
      default_cli_client: DEFAULT_CLI_CLIENT,
      auto_submit_enabled: false,
      theme_preference: null,
      cli_clients: [...CLI_CLIENTS],
      valid_theme_preferences: [...VALID_THEME_PREFERENCES],
      ok: true,
    })
  })

  test('returns stored settings and describes the current repo from its git remote', async () => {
    const repoName = 'api'
    const repoSlug = `acme/${repoName}`
    const repoPath = await createGitRepository(reposFolder.path, repoName, repoSlug)
    const [, cliClient = DEFAULT_CLI_CLIENT] = CLI_CLIENTS
    const [themePreference] = VALID_THEME_PREFERENCES
    settingStore.write(SETTING_KEYS.reposFolder, reposFolder.path)
    settingStore.write(SETTING_KEYS.currentRepo, repoPath)
    settingStore.write(SETTING_KEYS.defaultCliClient, cliClient)
    settingStore.write(SETTING_KEYS.autoSubmitEnabled, String(true))
    settingStore.write(SETTING_KEYS.themePreference, themePreference)

    const { body } = await getSettings()

    expect(body).toMatchObject({
      repos_folder: reposFolder.path,
      current_repo: { path: repoPath, slug: repoSlug, name: repoName },
      default_cli_client: cliClient,
      auto_submit_enabled: true,
      theme_preference: themePreference,
    })
  })

  test('ignores a stored theme that is not a valid preference', async () => {
    const invalidTheme = 'solarized'
    settingStore.write(SETTING_KEYS.themePreference, invalidTheme)

    const { body } = await getSettings()

    expect(body?.theme_preference).toBeNull()
  })

  test('recovers a missing current repo from the only repo with open pull requests', async () => {
    const repoOwner = 'acme'
    const repoName = 'web'
    const repoSlug = `${repoOwner}/${repoName}`
    const recoveredPath = await createGitRepository(reposFolder.path, repoName, repoSlug)
    const missingPath = join(reposFolder.path, 'deleted-checkout')
    settingStore.write(SETTING_KEYS.reposFolder, reposFolder.path)
    settingStore.write(SETTING_KEYS.currentRepo, missingPath)
    insertPullRequest(db, { repoOwner, repoName })

    const { body } = await getSettings()

    expect(body?.current_repo).toEqual({ path: recoveredPath, slug: repoSlug, name: repoName })
    expect(settingStore.currentRepo()).toBe(recoveredPath)
  })

  test('resolves relative stored paths from the working directory and returns them as stored', async () => {
    const relativeReposFolder = 'repos'
    const repoName = 'api'
    const repoSlug = `acme/${repoName}`
    const relativeRepoPath = join(relativeReposFolder, repoName)
    mkdirSync(join(reposFolder.path, relativeReposFolder))
    await createGitRepository(join(reposFolder.path, relativeReposFolder), repoName, repoSlug)
    settingStore.write(SETTING_KEYS.reposFolder, relativeReposFolder)
    settingStore.write(SETTING_KEYS.currentRepo, relativeRepoPath)
    const originalWorkingDirectory = process.cwd()
    process.chdir(reposFolder.path)

    try {
      const { body } = await getSettings()

      expect(body?.current_repo).toEqual({ path: relativeRepoPath, slug: repoSlug, name: repoName })
    } finally {
      process.chdir(originalWorkingDirectory)
    }
  })

  test('keeps a missing current repo when open pull requests span several repos', async () => {
    const repoOwner = 'acme'
    const firstRepoName = 'web'
    const secondRepoName = 'api'
    const missingDirectoryName = 'deleted-checkout'
    const missingPath = join(reposFolder.path, missingDirectoryName)
    await createGitRepository(reposFolder.path, firstRepoName, `${repoOwner}/${firstRepoName}`)
    settingStore.write(SETTING_KEYS.reposFolder, reposFolder.path)
    settingStore.write(SETTING_KEYS.currentRepo, missingPath)
    insertPullRequest(db, { repoOwner, repoName: firstRepoName })
    insertPullRequest(db, { repoOwner, repoName: secondRepoName })

    const { body } = await getSettings()

    expect(body?.current_repo).toEqual({ path: missingPath, slug: null, name: missingDirectoryName })
    expect(settingStore.currentRepo()).toBe(missingPath)
  })
})
