import { statSync } from 'node:fs'
import type { CommandRunner } from '../commands/runner'

export function isDirectory(path: string) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// Runs `git -C <repoPath> ...args`; returns trimmed stdout, or null on failure.
export async function gitOutput(commands: CommandRunner, repoPath: string, args: string[]): Promise<string | null> {
  try {
    const result = await commands.run(['git', '-C', repoPath, ...args])
    return result.success ? result.stdout.trim() : null
  } catch {
    return null
  }
}
