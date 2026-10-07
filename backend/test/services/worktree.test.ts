import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { CommandNotFoundError } from '../../src/commands/runner'
import { logger } from '../../src/lib/logger'
import { isDirectory } from '../../src/services/git'
import { WORKTREES_DIR, WorktreeNetworkError, WorktreeService, WorktreeServiceError } from '../../src/services/worktree'
import { FakeCommandRunner } from '../support/context'
import { createTempFolder } from '../support/git'

let repo: ReturnType<typeof createTempFolder>
let commands: FakeCommandRunner
let sleeps: number[]
let service: WorktreeService
let worktreesBase: string
let worktreePath: string

const pullRequest = { number: 42 }
const branchName = 'feature/test'

function fetchCommand() {
  return ['git', '-C', repo.path, 'fetch', 'origin', `pull/${pullRequest.number}/head`]
}

function branchWorktreeCommand(path: string, branch = branchName) {
  return ['git', '-C', repo.path, 'worktree', 'add', path, '-b', `ordem-review-pr-${pullRequest.number}`, `origin/${branch}`]
}

function fetchHeadWorktreeCommand(path: string) {
  return ['git', '-C', repo.path, 'worktree', 'add', path, 'FETCH_HEAD']
}

function removeCommand(path: string) {
  return ['git', '-C', repo.path, 'worktree', 'remove', '--force', path]
}

function ghViewCommand() {
  return ['gh', 'pr', 'view', String(pullRequest.number), '--json', 'headRefName']
}

// Replays `results` in order, repeating the last one.
function sequence(...results: Array<{ success: boolean; stderr?: string; stdout?: string }>) {
  let index = 0
  return () => results[Math.min(index++, results.length - 1)] ?? {}
}

beforeEach(() => {
  repo = createTempFolder()
  commands = new FakeCommandRunner()
  sleeps = []
  service = new WorktreeService({ commands }, repo.path, {
    sleep: async (seconds) => {
      sleeps.push(seconds)
    },
  })
  worktreesBase = join(repo.path, WORKTREES_DIR)
  worktreePath = join(worktreesBase, `pr-${pullRequest.number}`)
})

afterEach(() => {
  repo.remove()
})

describe('WorktreeService', () => {
  test('expands the repo path like File.expand_path', () => {
    const home = process.env.HOME ?? homedir()
    const relative = 'some/repo'

    expect(new WorktreeService({ commands }, '~/repo').repoPath).toBe(join(home, 'repo'))
    expect(new WorktreeService({ commands }, relative).repoPath).toBe(resolve(relative))
  })

  test('sets worktrees_base under the repo', () => {
    expect(service.worktreesBase).toBe(worktreesBase)
  })

  test.each([[null], ['  ']])('cleanup_worktree does nothing for %p', async (path) => {
    await service.cleanupWorktree(path)

    expect(commands.calls).toEqual([])
  })

  test.each([
    'Connection refused',
    'Connection timed out',
    'Could not resolve host',
    'Network is unreachable',
    'Connection reset by peer',
    'Temporary failure in name resolution',
  ])('transient_error? matches %p', (message) => {
    expect(service.isTransientError(message)).toBe(true)
  })

  test('transient_error? returns false for non-transient errors', () => {
    expect(service.isTransientError('Authentication failed')).toBe(false)
    expect(service.isTransientError('File not found')).toBe(false)
  })

  describe('withRetry', () => {
    test('succeeds immediately', async () => {
      const value = 'success'
      let attempts = 0

      const result = await service.withRetry('test op', async () => {
        attempts += 1
        return value
      })

      expect(attempts).toBe(1)
      expect(result).toBe(value)
    })

    test('retries transient errors', async () => {
      const value = 'success'
      let attempts = 0

      const result = await service.withRetry('test op', async () => {
        attempts += 1
        if (attempts < 2) throw new WorktreeServiceError('Connection timed out')
        return value
      })

      expect(attempts).toBe(2)
      expect(result).toBe(value)
    })

    test('raises NetworkError after max retries', async () => {
      const retries = 2
      let attempts = 0

      const attempt = service.withRetry(
        'test op',
        async () => {
          attempts += 1
          throw new WorktreeServiceError('Connection refused')
        },
        { retries },
      )

      await expect(attempt).rejects.toBeInstanceOf(WorktreeNetworkError)
      expect(attempts).toBe(retries)
    })

    test('raises non-transient errors immediately', async () => {
      const message = 'Invalid credentials'
      let attempts = 0

      const attempt = service.withRetry('test op', async () => {
        attempts += 1
        throw new WorktreeServiceError(message)
      })

      await expect(attempt).rejects.toThrow(message)
      expect(attempts).toBe(1)
    })
  })

  describe('createForPr', () => {
    function scriptSuccessfulCheckout(headRefName = branchName) {
      commands.on(ghViewCommand(), { stdout: JSON.stringify({ headRefName }) })
      commands.on(fetchCommand(), { success: true })
      commands.on(['git', '-C', repo.path, 'worktree', 'add'], { success: true })
    }

    test('creates worktree successfully', async () => {
      scriptSuccessfulCheckout()

      const path = await service.createForPr(pullRequest)

      expect(path).toBe(worktreePath)
      expect(commands.calls.map((call) => call.command)).toEqual([ghViewCommand(), fetchCommand(), branchWorktreeCommand(worktreePath)])
      expect(commands.commandsMatching(['gh'])[0]?.options.cwd).toBe(repo.path)
    })

    test('creates worktrees_base directory', async () => {
      scriptSuccessfulCheckout()

      await service.createForPr(pullRequest)

      expect(isDirectory(worktreesBase)).toBe(true)
    })

    test('cleans up existing worktree', async () => {
      mkdirSync(worktreePath, { recursive: true })
      scriptSuccessfulCheckout()
      commands.on(removeCommand(worktreePath), { success: true })

      await service.createForPr(pullRequest)

      expect(commands.commandsMatching(removeCommand(worktreePath))).toHaveLength(1)
      expect(isDirectory(worktreePath)).toBe(false)
    })

    test('reuses the legacy directory so a recovered review cleans its old checkout', async () => {
      const legacyBase = join(repo.path, '.forge-worktrees')
      const legacyPath = join(legacyBase, `pr-${pullRequest.number}`)
      mkdirSync(legacyPath, { recursive: true })
      scriptSuccessfulCheckout()
      commands.on(removeCommand(legacyPath), { success: true })
      const upgraded = new WorktreeService({ commands }, repo.path)

      const path = await upgraded.createForPr(pullRequest)

      expect(path).toBe(legacyPath)
      expect(commands.calls.map((call) => call.command)).toEqual([ghViewCommand(), removeCommand(legacyPath), fetchCommand(), branchWorktreeCommand(legacyPath)])
      expect(isDirectory(legacyPath)).toBe(false)
      expect(isDirectory(worktreesBase)).toBe(false)
    })

    test('uses fallback branch name when gh fails', async () => {
      const fallbackBranch = `pr-${pullRequest.number}`
      commands.on(ghViewCommand(), { success: false, stderr: 'boom' })
      commands.on(fetchCommand(), { success: true })
      commands.on(['git', '-C', repo.path, 'worktree', 'add'], { success: true })

      await service.createForPr(pullRequest)

      expect(commands.commandsMatching(branchWorktreeCommand(worktreePath, fallbackBranch))).toHaveLength(1)
    })
  })

  describe('cleanup', () => {
    test('cleanup_worktree removes via git and rm_rf', async () => {
      mkdirSync(worktreePath, { recursive: true })
      commands.on(removeCommand(worktreePath), { success: true })

      await service.cleanupWorktree(worktreePath)

      expect(commands.calls.map((call) => call.command)).toEqual([removeCommand(worktreePath)])
      expect(isDirectory(worktreePath)).toBe(false)
    })

    test('cleanup_worktree warns when git remove fails but still removes directory', async () => {
      const stderr = 'fatal'
      const warn = spyOn(logger, 'warn')
      mkdirSync(worktreePath, { recursive: true })
      commands.on(removeCommand(worktreePath), { success: false, stderr })

      try {
        await service.cleanupWorktree(worktreePath)

        expect(warn).toHaveBeenCalledWith(`Worktree cleanup warning: ${stderr}`)
        expect(isDirectory(worktreePath)).toBe(false)
      } finally {
        warn.mockRestore()
      }
    })

    test('cleanup_all prunes worktrees and removes base directory', async () => {
      const pruneCommand = ['git', '-C', repo.path, 'worktree', 'prune']
      mkdirSync(worktreesBase, { recursive: true })
      commands.on(pruneCommand, { success: true })

      await service.cleanupAll()

      expect(commands.calls.map((call) => call.command)).toEqual([pruneCommand])
      expect(isDirectory(worktreesBase)).toBe(false)
      expect(isDirectory(repo.path)).toBe(true)
    })

    test('cleanup_all works when worktrees_base does not exist', async () => {
      commands.on(['git', '-C', repo.path, 'worktree', 'prune'], { success: true })

      await service.cleanupAll()

      expect(commands.calls).toHaveLength(1)
      expect(isDirectory(worktreesBase)).toBe(false)
    })

    test('cleanup_all includes both legacy and Ordem directories', async () => {
      const legacyBase = join(repo.path, '.forge-worktrees')
      mkdirSync(legacyBase, { recursive: true })
      mkdirSync(worktreesBase, { recursive: true })
      commands.on(['git', '-C', repo.path, 'worktree', 'prune'], { success: true })

      await service.cleanupAll()

      expect(isDirectory(legacyBase)).toBe(false)
      expect(isDirectory(worktreesBase)).toBe(false)
      expect(isDirectory(repo.path)).toBe(true)
    })
  })

  describe('fetchPrBranch', () => {
    test('returns branch name from gh', async () => {
      commands.on(ghViewCommand(), { stdout: JSON.stringify({ headRefName: branchName }) })

      expect(await service.fetchPrBranch(pullRequest)).toBe(branchName)
    })

    test.each([
      ['gh error', { success: false, stderr: 'boom' }],
      ['invalid JSON', { stdout: '{bad json' }],
    ])('falls back to pr-N on %s', async (_label, result) => {
      const fallbackBranch = `pr-${pullRequest.number}`
      commands.on(ghViewCommand(), result)

      expect(await service.fetchPrBranch(pullRequest)).toBe(fallbackBranch)
    })

    test('falls back to pr-N when gh is missing', async () => {
      const fallbackBranch = `pr-${pullRequest.number}`
      commands.on(ghViewCommand(), (command) => {
        throw new CommandNotFoundError(command)
      })

      expect(await service.fetchPrBranch(pullRequest)).toBe(fallbackBranch)
    })
  })

  describe('fetchPrRef', () => {
    test('fetches PR successfully', async () => {
      commands.on(fetchCommand(), { success: true })

      await service.fetchPrRef(pullRequest)

      expect(commands.calls.map((call) => call.command)).toEqual([fetchCommand()])
    })

    test('does not checkout or switch branches', async () => {
      commands.on(fetchCommand(), { success: true })

      await service.fetchPrRef(pullRequest)

      expect(commands.commandsMatching(['gh', 'pr', 'checkout'])).toEqual([])
      expect(commands.commandsMatching(['git', '-C', repo.path, 'checkout'])).toEqual([])
    })

    test.each([
      [null, 'nil'],
      [0, '0'],
      [-3, '-3'],
    ])('raises Error for invalid PR number %p', async (number, inspected) => {
      const attempt = service.fetchPrRef({ number })

      await expect(attempt).rejects.toThrow(`Invalid PR number: ${inspected}`)
      expect(commands.calls).toEqual([])
    })

    test('retries on transient network errors', async () => {
      const warn = spyOn(logger, 'warn')
      commands.on(fetchCommand(), sequence({ success: false, stderr: 'Connection timed out' }, { success: true }))

      try {
        await service.fetchPrRef(pullRequest)

        expect(commands.calls).toHaveLength(2)
        expect(sleeps).toEqual([2])
        expect(warn).toHaveBeenCalledWith(
          expect.stringMatching(new RegExp(`Transient network error during fetch PR #${pullRequest.number}, attempt 1/3`)),
        )
      } finally {
        warn.mockRestore()
      }
    })

    test('raises NetworkError after max retries on transient errors', async () => {
      const stderr = 'Connection refused'
      const warn = spyOn(logger, 'warn')
      commands.on(fetchCommand(), { success: false, stderr })

      try {
        const error = await service.fetchPrRef(pullRequest).catch((caught: unknown) => caught)

        expect(error).toBeInstanceOf(WorktreeNetworkError)
        expect(String(error)).toContain(stderr)
        expect(String(error)).toContain('after 3 attempts')
        expect(commands.calls).toHaveLength(3)
        expect(warn).toHaveBeenCalledTimes(2)
        expect(sleeps).toEqual([2, 4])
      } finally {
        warn.mockRestore()
      }
    })

    test('raises Error on non-transient errors immediately', async () => {
      const stderr = 'Authentication failed'
      commands.on(fetchCommand(), { success: false, stderr })

      const error = await service.fetchPrRef(pullRequest).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(WorktreeServiceError)
      expect(error).not.toBeInstanceOf(WorktreeNetworkError)
      expect(error instanceof Error && error.message).toBe(`Failed to fetch PR: ${stderr}`)
      expect(sleeps).toEqual([])
    })
  })

  describe('createWorktree', () => {
    test('creates worktree with branch', async () => {
      commands.on(branchWorktreeCommand(worktreePath), { success: true })

      await service.createWorktree(worktreePath, branchName, pullRequest)

      expect(commands.calls.map((call) => call.command)).toEqual([branchWorktreeCommand(worktreePath)])
    })

    test('falls back to FETCH_HEAD when branch add fails', async () => {
      commands.on(branchWorktreeCommand(worktreePath), { success: false, stderr: 'missing branch' })
      commands.on(fetchHeadWorktreeCommand(worktreePath), { success: true })

      await service.createWorktree(worktreePath, branchName, pullRequest)

      expect(commands.calls.map((call) => call.command)).toEqual([branchWorktreeCommand(worktreePath), fetchHeadWorktreeCommand(worktreePath)])
    })

    test('raises Error when FETCH_HEAD also fails', async () => {
      const stderr = 'still broken'
      commands.on(branchWorktreeCommand(worktreePath), { success: false, stderr: 'missing branch' })
      commands.on(fetchHeadWorktreeCommand(worktreePath), { success: false, stderr })

      const attempt = service.createWorktree(worktreePath, branchName, pullRequest)

      await expect(attempt).rejects.toThrow(`Failed to create worktree: ${stderr}`)
    })

    test('raises Error when path validation fails', async () => {
      const outside = createTempFolder()

      try {
        const attempt = service.createWorktree(join(outside.path, 'pr-42'), branchName, pullRequest)

        await expect(attempt).rejects.toThrow('Invalid worktree path')
        expect(commands.calls).toEqual([])
      } finally {
        outside.remove()
      }
    })
  })
})
