import { mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AppContext } from '../context'
import { logger } from '../lib/logger'
import { isBlank } from '../lib/ruby'
import { isDirectory } from './git'
import { validateNewPath } from './path-validator'

// Port of WorktreeService: checks a PR out into its own git worktree under
// <repo>/.ordem-worktrees so reviews never touch the user's working copy.
export class WorktreeServiceError extends Error {}
export class WorktreeNetworkError extends WorktreeServiceError {}

export const WORKTREES_DIR = '.ordem-worktrees'
const LEGACY_WORKTREES_DIR = '.forge-worktrees'
export const MAX_RETRIES = 3
export const RETRY_DELAY_SECONDS = 2

const TRANSIENT_ERROR_PATTERNS = [
  /Connection refused/i,
  /Connection timed out/i,
  /Could not resolve host/i,
  /Network is unreachable/i,
  /Connection reset by peer/i,
  /Temporary failure in name resolution/i,
]

export interface WorktreePullRequest {
  number: number | null
}

export interface WorktreeServiceOptions {
  sleep?: (seconds: number) => Promise<void>
}

// File.expand_path: "~" is $HOME, relative paths resolve against the cwd.
function expandPath(path: string) {
  if (path === '~' || path.startsWith('~/')) return resolve(process.env.HOME ?? homedir(), path.slice(2))
  return resolve(path)
}

// Ruby's Integer#inspect / nil.inspect for the error message.
function inspectNumber(value: number | null) {
  return value === null ? 'nil' : String(value)
}

export class WorktreeService {
  readonly repoPath: string
  readonly worktreesBase: string
  private readonly sleep: (seconds: number) => Promise<void>

  constructor(
    private readonly ctx: Pick<AppContext, 'commands'>,
    repoPath: string,
    options: WorktreeServiceOptions = {},
  ) {
    this.repoPath = expandPath(repoPath)
    const legacyBase = join(this.repoPath, LEGACY_WORKTREES_DIR)
    // Reuse existing checkouts after a rebrand so retries still clean them up.
    this.worktreesBase = isDirectory(legacyBase) && validateNewPath(legacyBase, this.repoPath) !== null
      ? legacyBase
      : join(this.repoPath, WORKTREES_DIR)
    this.sleep = options.sleep ?? ((seconds) => Bun.sleep(seconds * 1000))
  }

  async createForPr(pullRequest: WorktreePullRequest) {
    const branchName = await this.fetchPrBranch(pullRequest)
    const worktreePath = join(this.worktreesBase, `pr-${pullRequest.number ?? ''}`)

    mkdirSync(this.worktreesBase, { recursive: true })
    if (isDirectory(worktreePath)) await this.cleanupWorktree(worktreePath)

    await this.fetchPrRef(pullRequest)
    await this.createWorktree(worktreePath, branchName, pullRequest)
    return worktreePath
  }

  async cleanupWorktree(worktreePath: string | null) {
    if (isBlank(worktreePath)) return

    const result = await this.ctx.commands.run(['git', '-C', this.repoPath, 'worktree', 'remove', '--force', worktreePath])
    if (!result.success) logger.warn(`Worktree cleanup warning: ${result.stderr}`)

    if (isDirectory(worktreePath)) rmSync(worktreePath, { recursive: true, force: true })
  }

  async cleanupAll() {
    await this.ctx.commands.run(['git', '-C', this.repoPath, 'worktree', 'prune'])
    for (const directory of [WORKTREES_DIR, LEGACY_WORKTREES_DIR]) {
      const base = join(this.repoPath, directory)
      if (isDirectory(base)) rmSync(base, { recursive: true, force: true })
    }
  }

  // Head branch name from gh; falls back to "pr-<number>" on any failure.
  async fetchPrBranch(pullRequest: WorktreePullRequest): Promise<string | null> {
    const fallback = `pr-${pullRequest.number ?? ''}`
    try {
      const result = await this.ctx.commands.run(['gh', 'pr', 'view', String(pullRequest.number ?? ''), '--json', 'headRefName'], {
        cwd: this.repoPath,
      })
      if (!result.success) return fallback

      const data: unknown = JSON.parse(result.stdout)
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return fallback
      const headRefName = 'headRefName' in data ? data.headRefName : null
      if (headRefName === null || headRefName === undefined) return null
      return String(headRefName)
    } catch {
      return fallback
    }
  }

  async fetchPrRef(pullRequest: WorktreePullRequest) {
    const prNumber = this.normalizePrNumber(pullRequest.number)
    const prRef = `pull/${prNumber}/head`

    await this.withRetry(`fetch PR #${prNumber}`, async () => {
      const result = await this.ctx.commands.run(['git', '-C', this.repoPath, 'fetch', 'origin', prRef])
      if (!result.success) throw new WorktreeServiceError(`Failed to fetch PR: ${result.stderr}`)
    })
  }

  async withRetry<Result>(
    operation: string,
    work: () => Promise<Result>,
    options: { retries?: number; delay?: number } = {},
  ): Promise<Result> {
    const retries = options.retries ?? MAX_RETRIES
    const delay = options.delay ?? RETRY_DELAY_SECONDS

    for (let attempts = 1; ; attempts += 1) {
      try {
        return await work()
      } catch (error) {
        if (!(error instanceof WorktreeServiceError)) throw error
        if (!this.isTransientError(error.message)) throw error
        if (attempts >= retries) throw new WorktreeNetworkError(`${error.message} (after ${attempts} attempts)`)

        logger.warn(`Transient network error during ${operation}, attempt ${attempts}/${retries}: ${error.message}`)
        await this.sleep(delay * attempts)
      }
    }
  }

  isTransientError(message: string) {
    return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  }

  // Only a positive integer may be interpolated into the fetched ref.
  normalizePrNumber(value: number | null) {
    if (value === null || !Number.isInteger(value) || value <= 0) {
      throw new WorktreeServiceError(`Invalid PR number: ${inspectNumber(value)}`)
    }
    return value
  }

  async createWorktree(worktreePath: string, branchName: string | null, pullRequest: WorktreePullRequest) {
    const validatedWorktree = validateNewPath(worktreePath, this.repoPath)
    if (validatedWorktree === null) throw new WorktreeServiceError('Invalid worktree path')

    const branchRef = `ordem-review-pr-${pullRequest.number ?? ''}`
    const remoteRef = `origin/${branchName ?? ''}`

    const branchResult = await this.ctx.commands.run([
      'git', '-C', this.repoPath, 'worktree', 'add', validatedWorktree, '-b', branchRef, remoteRef,
    ])
    if (branchResult.success) return

    const fetchHeadResult = await this.ctx.commands.run(['git', '-C', this.repoPath, 'worktree', 'add', validatedWorktree, 'FETCH_HEAD'])
    if (!fetchHeadResult.success) throw new WorktreeServiceError(`Failed to create worktree: ${fetchHeadResult.stderr}`)
  }
}
