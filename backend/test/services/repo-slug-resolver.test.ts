import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { slugFromPath, slugFromRemote } from '../../src/services/repo-slug-resolver'
import { createCheckoutFolder, createGitRepository, createTempFolder } from '../support/git'
import { FakeCommandRunner } from '../support/context'

const owner = 'acme'
const name = 'api'
const slug = `${owner}/${name}`

describe('slugFromRemote', () => {
  test.each([
    `git@github.com:${slug}.git`,
    `https://github.com/${slug}.git`,
    `https://github.com/${slug}`,
    `  git@github.com:${slug}.git\n`,
  ])('extracts the slug from %p', (remote) => {
    expect(slugFromRemote(remote)).toBe(slug)
  })

  test.each([null, '', '   ', `https://gitlab.com/${slug}.git`])('returns null for %p', (remote) => {
    expect(slugFromRemote(remote)).toBeNull()
  })
})

describe('slugFromPath', () => {
  let tempFolder: ReturnType<typeof createTempFolder>

  beforeEach(() => {
    tempFolder = createTempFolder()
  })

  afterEach(() => tempFolder.remove())

  test('reads the origin remote of a git checkout', async () => {
    const commands = new FakeCommandRunner()
    const repoPath = createGitRepository(commands, tempFolder.path, name, slug)

    expect(await slugFromPath(commands, repoPath)).toBe(slug)
  })

  test('returns null when git fails', async () => {
    const commands = new FakeCommandRunner()
    const repoPath = createCheckoutFolder(tempFolder.path, name)
    commands.on(['git', '-C', repoPath], { exitCode: 128 })

    expect(await slugFromPath(commands, repoPath)).toBeNull()
  })

  test('returns null for missing directories without asking git', async () => {
    const commands = new FakeCommandRunner()
    const missingPath = `${tempFolder.path}/missing`

    expect(await slugFromPath(commands, missingPath)).toBeNull()
    expect(commands.calls).toEqual([])
  })
})
