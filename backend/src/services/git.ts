import { statSync } from 'node:fs'

export function isDirectory(path: string) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// Runs `git -C <repoPath> ...args`; returns trimmed stdout, or null on failure.
export async function gitOutput(repoPath: string, args: string[]): Promise<string | null> {
  try {
    const child = Bun.spawn(['git', '-C', repoPath, ...args], { stdout: 'pipe', stderr: 'ignore' })
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
    return exitCode === 0 ? stdout.trim() : null
  } catch {
    return null
  }
}
