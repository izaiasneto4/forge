import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CommandRunner } from '../commands/runner'
import { isBlank } from '../lib/ruby'
import { gitOutput, isDirectory } from './git'

export interface ScannedRepository {
  name: string
  path: string
  remote_url: string
  branch: string
}

export function isGitRepository(path: string) {
  const gitPath = join(path, '.git')
  try {
    const stats = statSync(gitPath)
    if (stats.isDirectory()) {
      return true
    }

    return stats.isFile() && readFileSync(gitPath, 'utf8').slice(0, 256).startsWith('gitdir:')
  } catch {
    return false
  }
}

async function describeRepository(commands: CommandRunner, name: string, path: string): Promise<ScannedRepository | null> {
  // Incomplete `.git` dirs still pass `isGitRepository`; without a ceiling, git
  // walks into a parent checkout and reports that remote/branch instead.
  const ceiling = dirname(path)
  const toplevel = await gitOutput(commands, path, ['rev-parse', '--show-toplevel'], { ceiling })
  if (isBlank(toplevel)) return null

  const [remoteUrl, branch] = await Promise.all([
    gitOutput(commands, path, ['remote', 'get-url', 'origin'], { ceiling }),
    gitOutput(commands, path, ['branch', '--show-current'], { ceiling }),
  ])

  return { name, path, remote_url: remoteUrl ?? '', branch: branch ?? '' }
}

// Lists git repositories directly under `baseFolder`, sorted case-insensitively.
export async function scanRepositories(commands: CommandRunner, baseFolder: string | null): Promise<ScannedRepository[]> {
  if (isBlank(baseFolder) || !isDirectory(baseFolder)) {
    return []
  }

  const repositoryEntries = readdirSync(baseFolder)
    .filter((entry) => !entry.startsWith('.'))
    .map((entry) => ({ name: entry, path: join(baseFolder, entry) }))
    .filter(({ path }) => isDirectory(path) && isGitRepository(path))

  const described = await Promise.all(repositoryEntries.map(({ name, path }) => describeRepository(commands, name, path)))
  const repositories = described.filter((repository): repository is ScannedRepository => repository !== null)
  return repositories.sort((left, right) => {
    const leftName = left.name.toLowerCase()
    const rightName = right.name.toLowerCase()
    if (leftName === rightName) {
      return 0
    }

    return leftName < rightName ? -1 : 1
  })
}
