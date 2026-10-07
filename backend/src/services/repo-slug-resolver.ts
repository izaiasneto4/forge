import type { CommandRunner } from '../commands/runner'
import { isBlank } from '../lib/ruby'
import { gitOutput, isDirectory } from './git'

const GITHUB_REMOTE = /github\.com[:/](?<owner>[^/]+)\/(?<name>[^/]+?)(?:\.git)?$/

export function slugFromRemote(remote: string | null): string | null {
  if (isBlank(remote)) {
    return null
  }

  const match = GITHUB_REMOTE.exec(remote.trim())
  const owner = match?.groups?.owner
  const name = match?.groups?.name
  if (!owner || !name) {
    return null
  }

  return `${owner}/${name}`
}

export async function slugFromPath(commands: CommandRunner, path: string | null): Promise<string | null> {
  if (isBlank(path) || !isDirectory(path)) {
    return null
  }

  return slugFromRemote(await gitOutput(commands, path, ['remote', 'get-url', 'origin']))
}
