import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bunCommandRunner } from '../../src/commands/runner'
import { scanRepositories } from '../../src/services/repo-scanner'
import { createTempFolder } from '../support/git'

describe('scanRepositories', () => {
  const folders: Array<ReturnType<typeof createTempFolder>> = []

  afterEach(() => {
    while (folders.length > 0) folders.pop()?.remove()
  })

  test('skips incomplete git directories that would inherit a parent checkout', async () => {
    const root = createTempFolder()
    folders.push(root)

    const parentInit = await bunCommandRunner.run(['git', 'init', root.path])
    expect(parentInit.success).toBe(true)
    await bunCommandRunner.run(['git', '-C', root.path, 'remote', 'add', 'origin', 'https://github.com/parent/repo.git'])
    await bunCommandRunner.run(['git', '-C', root.path, 'commit', '--allow-empty', '-m', 'init'])

    const incomplete = join(root.path, 'ghost-checkout')
    mkdirSync(join(incomplete, '.git'), { recursive: true })
    writeFileSync(join(incomplete, '.git', 'HEAD'), 'ref: refs/heads/main\n')

    const withoutCeiling = await bunCommandRunner.run(['git', '-C', incomplete, 'remote', 'get-url', 'origin'])
    expect(withoutCeiling.success).toBe(true)

    const scanned = await scanRepositories(bunCommandRunner, root.path)
    expect(scanned.map((repo) => repo.name)).not.toContain('ghost-checkout')
  })

  test('lists real child repositories with their own remotes', async () => {
    const root = createTempFolder()
    folders.push(root)

    const child = join(root.path, 'acme-api')
    mkdirSync(child, { recursive: true })
    await bunCommandRunner.run(['git', 'init', child])
    await bunCommandRunner.run(['git', '-C', child, 'remote', 'add', 'origin', 'https://github.com/acme/api.git'])
    await bunCommandRunner.run(['git', '-C', child, 'commit', '--allow-empty', '-m', 'init'])
    await bunCommandRunner.run(['git', '-C', child, 'branch', '-M', 'main'])

    const scanned = await scanRepositories(bunCommandRunner, root.path)
    expect(scanned).toHaveLength(1)
    expect(scanned[0]?.name).toBe('acme-api')
    expect(scanned[0]?.path).toBe(child)
    expect(scanned[0]?.branch).toBe('main')
    expect(scanned[0]?.remote_url).toContain('acme/api')
  })

  test('applies an absolute ceiling when the repos folder is relative', async () => {
    const root = createTempFolder()
    folders.push(root)

    const parentInit = await bunCommandRunner.run(['git', 'init', root.path])
    expect(parentInit.success).toBe(true)
    await bunCommandRunner.run(['git', '-C', root.path, 'remote', 'add', 'origin', 'https://github.com/parent/repo.git'])
    await bunCommandRunner.run(['git', '-C', root.path, 'commit', '--allow-empty', '-m', 'init'])

    const incomplete = join(root.path, 'ghost-checkout')
    mkdirSync(join(incomplete, '.git'), { recursive: true })
    writeFileSync(join(incomplete, '.git', 'HEAD'), 'ref: refs/heads/main\n')

    const previousCwd = process.cwd()
    process.chdir(root.path)
    try {
      const scanned = await scanRepositories(bunCommandRunner, '.')
      expect(scanned.map((repo) => repo.name)).not.toContain('ghost-checkout')
    } finally {
      process.chdir(previousCwd)
    }
  })
})
