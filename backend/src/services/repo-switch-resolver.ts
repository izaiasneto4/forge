import { basename } from 'node:path'
import { isBlank } from '../models/setting'
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
export async function resolveRepoSlug(reposFolder: string | null, slug: string): Promise<RepoResolution> {
  if (isBlank(reposFolder) || !isDirectory(reposFolder)) {
    return { status: 'not_found', paths: [] }
  }

  const repositories = await scanRepositories(reposFolder)
  const matches = repositories
    .filter((repository) => slugFromRemote(repository.remote_url) === slug)
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
