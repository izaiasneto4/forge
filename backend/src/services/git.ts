import { statSync } from 'node:fs'
import type { CommandRunner } from '../commands/runner'

export function isDirectory(path: string) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export type GitOutputOptions = {
  // Absolute path that stops git from walking into a parent checkout when
  // `repoPath` has an incomplete `.git` directory.
  ceiling?: string
}

// Runs `git -C <repoPath> ...args`; returns trimmed stdout, or null on failure.
export async function gitOutput(
  commands: CommandRunner,
  repoPath: string,
  args: string[],
  options: GitOutputOptions = {},
): Promise<string | null> {
  try {
    const env = options.ceiling ? { GIT_CEILING_DIRECTORIES: options.ceiling } : undefined
    const result = await commands.run(['git', '-C', repoPath, ...args], env ? { env } : undefined)
    return result.success ? result.stdout.trim() : null
  } catch {
    return null
  }
}
