import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function createTempFolder() {
  const path = mkdtempSync(join(tmpdir(), 'forge-backend-'))
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) }
}

export function githubRemote(slug: string) {
  return `git@github.com:${slug}.git`
}

export async function createGitRepository(parentFolder: string, directoryName: string, slug: string) {
  const path = join(parentFolder, directoryName)
  mkdirSync(path)
  await Bun.$`git init --quiet ${path}`
  await Bun.$`git -C ${path} remote add origin ${githubRemote(slug)}`
  return path
}
