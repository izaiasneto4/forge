import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
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

async function describeRepository(commands: CommandRunner, name: string, path: string): Promise<ScannedRepository> {
  const [remoteUrl, branch] = await Promise.all([
    gitOutput(commands, path, ['remote', 'get-url', 'origin']),
    gitOutput(commands, path, ['branch', '--show-current']),
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

  const repositories = await Promise.all(repositoryEntries.map(({ name, path }) => describeRepository(commands, name, path)))
  return repositories.sort((left, right) => {
    const leftName = left.name.toLowerCase()
    const rightName = right.name.toLowerCase()
    if (leftName === rightName) {
      return 0
    }

    return leftName < rightName ? -1 : 1
  })
}
