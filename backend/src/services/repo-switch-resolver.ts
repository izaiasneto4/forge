import { basename } from 'node:path'
import type { CommandRunner } from '../commands/runner'
import { isBlank } from '../lib/ruby'
import { isDirectory } from './git'
import { scanRepositories } from './repo-scanner'
import { slugFromRemote } from './repo-slug-resolver'

export type RepoResolution =
  | { status: 'ok'; path: string }
  | { status: 'not_found'; paths: string[] }
  | { status: 'ambiguous'; paths: string[] }

function preferExactRepoDirectory(paths: string[], slug: string) {
  const repoName = slug.split('/').slice(1).join('/')
  const exactMatches = paths.filter((path) => basename(path) === repoName)
  return exactMatches.length === 1 ? exactMatches[0] : undefined
}

// Finds the local checkout under `reposFolder` whose origin remote matches `slug`.
// `ignoreCase` matches GitHub, where `Acme/API` and `acme/api` are the same
// repository; the default keeps the Rails behavior for repo switching.
export async function resolveRepoSlug(
  commands: CommandRunner,
  reposFolder: string | null,
  slug: string,
  options: { ignoreCase?: boolean } = {},
): Promise<RepoResolution> {
  const normalize = (value: string | null) => (options.ignoreCase ? value?.toLowerCase() : value)
  if (isBlank(reposFolder) || !isDirectory(reposFolder)) {
    return { status: 'not_found', paths: [] }
  }

  const repositories = await scanRepositories(commands, reposFolder)
  const matches = repositories
    .filter((repository) => normalize(slugFromRemote(repository.remote_url)) === normalize(slug))
    .map((repository) => repository.path)

  const [onlyMatch] = matches
  if (onlyMatch === undefined) {
    return { status: 'not_found', paths: [] }
  }

  if (matches.length === 1) {
    return { status: 'ok', path: onlyMatch }
  }

  const preferred = preferExactRepoDirectory(matches, slug)
  if (preferred !== undefined) {
    return { status: 'ok', path: preferred }
  }

  return { status: 'ambiguous', paths: matches }
}
