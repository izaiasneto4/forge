import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expandFolderPath, inspectRepositoryFolder } from '../../src/services/repository-setup'
import { createTestContext, type TestContext } from '../support/context'
import { createCheckoutFolder, createGitRepository, createTempFolder } from '../support/git'

describe('expandFolderPath', () => {
  test('expands the home folder shorthand', () => {
    const projectPath = 'code/api'

    expect(expandFolderPath(`~/${projectPath}`)).toBe(join(homedir(), projectPath))
    expect(expandFolderPath('~')).toBe(homedir())
  })

  test('trims whitespace and trailing slashes', () => {
    const folder = '/Users/me/code'

    expect(expandFolderPath(`  ${folder}/  `)).toBe(folder)
  })
})

describe('inspectRepositoryFolder', () => {
  let ctx: TestContext
  let tempFolder: ReturnType<typeof createTempFolder>

  beforeEach(() => {
    ctx = createTestContext()
    tempFolder = createTempFolder()
  })

  afterEach(() => tempFolder.remove())

  test('reports a path that is not a folder', async () => {
    const missingPath = join(tempFolder.path, 'missing')

    expect(await inspectRepositoryFolder(ctx.commands, missingPath)).toEqual({ status: 'missing', path: missingPath })
  })

  test('recognizes a GitHub checkout', async () => {
    const slug = 'acme/api'
    const repoPath = createGitRepository(ctx.commands, tempFolder.path, 'api', slug)

    expect(await inspectRepositoryFolder(ctx.commands, repoPath)).toEqual({ status: 'repository', path: repoPath, slug })
  })

  test('rejects a checkout without a GitHub origin', async () => {
    const repoPath = createCheckoutFolder(tempFolder.path, 'local-only')
    ctx.commands.on(['git', '-C', repoPath, 'remote', 'get-url', 'origin'], { success: false })

    expect(await inspectRepositoryFolder(ctx.commands, repoPath)).toEqual({ status: 'not_github', path: repoPath })
  })

  test('treats a folder holding one GitHub checkout as that checkout', async () => {
    const slug = 'acme/web'
    const repoPath = createGitRepository(ctx.commands, tempFolder.path, 'web', slug)

    expect(await inspectRepositoryFolder(ctx.commands, tempFolder.path)).toEqual({ status: 'repository', path: repoPath, slug })
  })

  test('counts the GitHub checkouts in a folder of several', async () => {
    const slugs = ['acme/api', 'acme/web']
    for (const slug of slugs) createGitRepository(ctx.commands, tempFolder.path, slug.split('/')[1] ?? slug, slug)

    expect(await inspectRepositoryFolder(ctx.commands, tempFolder.path)).toEqual({ status: 'several', path: tempFolder.path, count: slugs.length })
  })

  test('reports a folder with no GitHub checkouts', async () => {
    mkdirSync(join(tempFolder.path, 'notes'))

    expect(await inspectRepositoryFolder(ctx.commands, tempFolder.path)).toEqual({ status: 'empty', path: tempFolder.path })
  })
})
