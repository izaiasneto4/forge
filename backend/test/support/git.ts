import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FakeCommandRunner } from './context'

export function createTempFolder() {
  const path = mkdtempSync(join(tmpdir(), 'ordem-backend-'))
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) }
}

export function githubRemote(slug: string) {
  return `git@github.com:${slug}.git`
}

export const DEFAULT_BRANCH = 'main'

// A folder the app treats as a checkout. The app asks git about it through the
// command runner, so pair it with stubGitRepository on the test's runner.
export function createCheckoutFolder(parentFolder: string, directoryName: string) {
  const path = join(parentFolder, directoryName)
  mkdirSync(join(path, '.git'), { recursive: true })
  return path
}

// Answers the git queries the app makes about a checkout: its toplevel, origin remote and branch.
export function stubGitRepository(commands: FakeCommandRunner, path: string, slug: string, branch = DEFAULT_BRANCH) {
  commands.on(['git', '-C', path, 'rev-parse', '--show-toplevel'], { stdout: `${path}\n` })
  commands.on(['git', '-C', path, 'remote', 'get-url', 'origin'], { stdout: `${githubRemote(slug)}\n` })
  commands.on(['git', '-C', path, 'branch', '--show-current'], { stdout: `${branch}\n` })
}

export function createGitRepository(commands: FakeCommandRunner, parentFolder: string, directoryName: string, slug: string, branch = DEFAULT_BRANCH) {
  const path = createCheckoutFolder(parentFolder, directoryName)
  stubGitRepository(commands, path, slug, branch)
  return path
}
