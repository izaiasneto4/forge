import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { CommandRunner } from '../commands/runner'
import { isDirectory } from './git'
import { isGitRepository, scanRepositories } from './repo-scanner'
import { slugFromPath, slugFromRemote } from './repo-slug-resolver'

export type RepositoryFolder =
  | { status: 'repository'; path: string; slug: string }
  | { status: 'several'; path: string; count: number }
  | { status: 'missing'; path: string }
  | { status: 'not_github'; path: string }
  | { status: 'empty'; path: string }

// Absolute path for what the user typed or picked; `~` means their home folder.
export function expandFolderPath(input: string) {
  const trimmed = input.trim()
  const expanded = trimmed === '~' || trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(1)) : trimmed
  return resolve(expanded)
}

// What a folder chosen in onboarding holds: a GitHub checkout, or a folder of
// them. A folder with a single checkout counts as that checkout.
export async function inspectRepositoryFolder(commands: CommandRunner, input: string): Promise<RepositoryFolder> {
  const path = expandFolderPath(input)
  if (!isDirectory(path)) return { status: 'missing', path }

  if (isGitRepository(path)) {
    const slug = await slugFromPath(commands, path)
    return slug === null ? { status: 'not_github', path } : { status: 'repository', path, slug }
  }

  const githubRepositories = (await scanRepositories(commands, path)).flatMap((repository) => {
    const slug = slugFromRemote(repository.remote_url)
    return slug === null ? [] : [{ path: repository.path, slug }]
  })
  const [onlyRepository] = githubRepositories
  if (onlyRepository === undefined) return { status: 'empty', path }
  if (githubRepositories.length === 1) return { status: 'repository', ...onlyRepository }
  return { status: 'several', path, count: githubRepositories.length }
}
