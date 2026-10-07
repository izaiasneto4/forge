import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../../src/lib/logger'
import { CLIENTS, CodeReviewError, CodeReviewService, type CodeReviewOptions } from '../../src/services/code-review'
import type { GithubCliClient, PullRequestComment } from '../../src/services/github-cli-client'
import { FakeCommandRunner } from '../support/context'
import { createTempFolder } from '../support/git'

function fakeGithubClient(comments: PullRequestComment[] = []): GithubCliClient {
  return {
    fetchPrComments: async () => comments,
    reviewRequestedForMe: async () => false,
    latestMyReviewState: async () => null,
  }
}

const pullRequest = {
  number: 42,
  title: 'Test PR Title',
  description: 'Test PR description',
  repoOwner: 'test',
  repoName: 'repo',
}

let worktree: ReturnType<typeof createTempFolder>
let commands: FakeCommandRunner

function buildService(options: Partial<CodeReviewOptions> = {}) {
  return CodeReviewService.for(
    { commands },
    { cliClient: 'claude', worktreePath: worktree.path, pullRequest, githubClientFor: async () => fakeGithubClient(), ...options },
  )
}

beforeEach(() => {
  worktree = createTempFolder()
  commands = new FakeCommandRunner()
})

afterEach(() => {
  worktree.remove()
})

describe('CodeReviewService.for', () => {
  test.each(['claude', 'codex', 'opencode'] as const)('creates service with %s client config', async (cliClient) => {
    const expected = CLIENTS[cliClient]

    const service = await buildService({ cliClient })

    expect(service.cliClient).toBe(cliClient)
    expect(service.command).toBe(expected.command)
    expect(service.args).toEqual(expected.args)
    expect(service.skill).toBe(expected.skill)
  })

  test('uses the documented CLI commands', () => {
    expect(CLIENTS.claude).toEqual({ command: 'claude', args: ['-p'], skill: '/code-review' })
    expect(CLIENTS.codex).toEqual({ command: 'codex', args: ['exec'], skill: null })
    expect(CLIENTS.opencode).toEqual({ command: 'opencode', args: ['run'], skill: null })
  })

  test('defaults to claude for unknown client', async () => {
    const cliClient = 'unknown'

    const service = await buildService({ cliClient })

    expect(service.command).toBe(CLIENTS.claude.command)
    expect(service.cliClient).toBe(cliClient)
  })

  test('accepts custom review_type', async () => {
    const reviewType = 'swarm'

    expect((await buildService({ reviewType })).reviewType).toBe(reviewType)
  })

  test('loads previous PR comments through a client for the worktree', async () => {
    const comments: PullRequestComment[] = [{ body: 'Nit', author: 'octo', created_at: null, path: 'app.rb', line: 3 }]
    const requestedPaths: string[] = []

    const service = await buildService({
      githubClientFor: async (repoPath) => {
        requestedPaths.push(repoPath)
        return fakeGithubClient(comments)
      },
    })

    expect(requestedPaths).toEqual([worktree.path])
    expect(service.previousComments).toEqual(comments)
  })

  test('treats a failure to fetch previous comments as none', async () => {
    const service = await buildService({
      githubClientFor: async () => {
        throw new Error('gh not authenticated')
      },
    })

    expect(service.previousComments).toEqual([])
  })
})

describe('detectModel', () => {
  const originalModel = process.env.ANTHROPIC_MODEL

  afterEach(() => {
    if (originalModel === undefined) delete process.env.ANTHROPIC_MODEL
    else process.env.ANTHROPIC_MODEL = originalModel
  })

  test('delegates to ModelDetector for the client', async () => {
    const model = 'claude-3.7-sonnet'
    process.env.ANTHROPIC_MODEL = model

    expect((await buildService()).detectModel()).toBe(model)
  })
})

describe('runReview', () => {
  test('raises Error when worktree does not exist', async () => {
    const service = await buildService({ worktreePath: '/nonexistent/path' })

    await expect(service.runReview()).rejects.toBeInstanceOf(CodeReviewError)
  })

  test('returns normalized output when command succeeds', async () => {
    const output = 'review output'
    const service = await buildService()
    commands.on(service.cmdArgsForReview(), { stdout: output })

    expect(await service.runReview()).toBe(output)
    expect(commands.calls[0]?.options.cwd).toBe(worktree.path)
  })

  test('returns output when command fails but output is present', async () => {
    const [output, stderr] = ['partial output', 'stderr']
    const service = await buildService()
    commands.on(service.cmdArgsForReview(), { stdout: output, stderr, success: false })
    const error = spyOn(logger, 'error')

    try {
      expect(await service.runReview()).toBe(output)
      expect(error).toHaveBeenCalledWith(`claude review error: ${stderr}`)
    } finally {
      error.mockRestore()
    }
  })

  test('raises Error when command fails with blank output', async () => {
    const stderr = 'stderr'
    const service = await buildService()
    commands.on(service.cmdArgsForReview(), { stdout: '', stderr, success: false })
    const error = spyOn(logger, 'error')

    try {
      await expect(service.runReview()).rejects.toThrow(`claude review failed: ${stderr}`)
      expect(error).toHaveBeenCalledWith(`claude review error: ${stderr}`)
    } finally {
      error.mockRestore()
    }
  })
})

describe('runReviewStreaming', () => {
  test('yields each line and returns normalized output', async () => {
    const lines = ['line 1\n', 'line 2\n']
    const service = await buildService()
    commands.on(service.cmdArgsForReview(), { stdout: lines.join('') })
    const yielded: string[] = []

    const result = await service.runReviewStreaming((line) => yielded.push(line))

    expect(yielded).toEqual(lines)
    expect(result).toBe(lines.join(''))
    expect(commands.calls[0]?.options.cwd).toBe(worktree.path)
  })

  test('ignores the exit status', async () => {
    const output = 'Partial review\n'
    const service = await buildService()
    commands.on(service.cmdArgsForReview(), { stdout: output, success: false })

    expect(await service.runReviewStreaming()).toBe(output)
  })

  test('returns the codex last message written during the run', async () => {
    const lastMessage = '```json\n[]\n```'
    const service = await buildService({ cliClient: 'codex' })
    writeFileSync(service.codexLastMessagePath(), 'stale message')
    commands.on(['codex', 'exec'], () => {
      writeFileSync(service.codexLastMessagePath(), lastMessage)
      return { stdout: 'echoed prompt\n' }
    })

    expect(await service.runReviewStreaming()).toBe(lastMessage)
  })

  test('raises Error when worktree does not exist', async () => {
    const service = await buildService({ worktreePath: join(worktree.path, 'missing') })

    await expect(service.runReviewStreaming()).rejects.toBeInstanceOf(CodeReviewError)
    expect(commands.calls).toEqual([])
  })
})

describe('prompts', () => {
  test('review_prompt uses standard review prompt for review type', async () => {
    const prompt = (await buildService()).reviewPrompt()

    expect(prompt).toContain(`Review PR #${pullRequest.number}`)
    expect(prompt).toContain(pullRequest.title)
    expect(prompt).toContain(pullRequest.description)
    expect(prompt).toContain('SCOPE CONSTRAINT')
    expect(prompt).toContain('ONLY review code that was actually changed')
  })

  test('review_prompt includes skill instruction for claude', async () => {
    const prompt = (await buildService()).reviewPrompt()

    expect(prompt).toContain(`Run ${CLIENTS.claude.skill} to analyze`)
  })

  test('review_prompt asks other clients to analyze the changes directly', async () => {
    const prompt = (await buildService({ cliClient: 'opencode' })).reviewPrompt()

    expect(prompt).toContain('Analyze the code changes.')
  })

  const swarmReviewers = [
    'Security Reviewer',
    'Data Consistency Reviewer',
    'Code Smell Reviewer',
    'Design Pattern Reviewer',
    'Performance Reviewer',
    'Maintainability Reviewer',
    'Regression Reviewer',
  ]
  const jsonFormatLines = [
    'JSON array wrapped in ```json',
    '"severity": "error" | "warning" | "info"',
    '"file": "path/to/file.ext"',
    '"lines": "10-20" or "10" or null',
    '"comment": "Detailed description of the issue in markdown"',
    '"suggested_fix": "Code suggestion if applicable, or null"',
  ]

  test('review_prompt uses swarm review prompt for swarm type', async () => {
    const prompt = (await buildService({ reviewType: 'swarm' })).reviewPrompt()

    expect(prompt).toContain('Deep Code Review - Multi-Agent Analysis')
    expect(prompt).toContain('7 specialized reviewer agents')
    for (const reviewer of swarmReviewers) expect(prompt).toContain(reviewer)
    expect(prompt).toContain('JSON array wrapped in ```json')
  })

  test('standard_review_prompt includes PR information', async () => {
    const prompt = (await buildService()).standardReviewPrompt()

    expect(prompt).toContain(`PR #${pullRequest.number}: ${pullRequest.title}`)
    expect(prompt).toContain(pullRequest.description)
  })

  test('standard_review_prompt includes scope constraints', async () => {
    const prompt = (await buildService()).standardReviewPrompt()

    expect(prompt).toContain('IMPORTANT SCOPE CONSTRAINT')
    expect(prompt).toContain('Use `gh pr diff` or `git diff`')
    expect(prompt).toContain("Do NOT review or comment on files that weren't modified")
    expect(prompt).toContain('Only flag issues on lines that were added or modified')
  })

  test('standard_review_prompt includes review focus areas', async () => {
    const prompt = (await buildService()).standardReviewPrompt()

    for (const area of ['Code quality and best practices', 'Potential bugs or issues', 'Security concerns', 'Performance implications']) {
      expect(prompt).toContain(area)
    }
  })

  test('standard_review_prompt includes JSON output format', async () => {
    const prompt = (await buildService()).standardReviewPrompt()

    for (const line of jsonFormatLines) expect(prompt).toContain(line)
  })

  test('standard_review_prompt includes empty array example', async () => {
    const prompt = (await buildService()).standardReviewPrompt()

    expect(prompt).toContain('If no issues found, return an empty array')
    expect(prompt).toContain('```json\\n[]\\n```')
  })

  test('swarm_review_prompt includes all 7 reviewers', async () => {
    const prompt = (await buildService({ reviewType: 'swarm' })).swarmReviewPrompt()

    for (const reviewer of swarmReviewers) expect(prompt).toContain(reviewer)
  })

  test('swarm_review_prompt includes consensus rules', async () => {
    const prompt = (await buildService({ reviewType: 'swarm' })).swarmReviewPrompt()

    for (const rule of ['Consensus Rules', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) expect(prompt).toContain(rule)
  })

  test('swarm_review_prompt includes report structure', async () => {
    const prompt = (await buildService({ reviewType: 'swarm' })).swarmReviewPrompt()

    for (const line of jsonFormatLines) expect(prompt).toContain(line)
  })

  test('swarm_review_prompt includes implementation instructions', async () => {
    const prompt = (await buildService({ reviewType: 'swarm' })).swarmReviewPrompt()

    expect(prompt).toContain('Consensus Rules')
    expect(prompt).toContain('Merge similar issues across reviewers')
  })

  test('prompts list previous PR comments, truncated to 501 characters', async () => {
    const longBody = 'a'.repeat(600)
    const comments: PullRequestComment[] = [
      { body: longBody, author: 'octo', created_at: null, path: 'app/x.rb', line: 3 },
      { body: 'General note', author: 'reviewer', created_at: null, path: null, line: null },
    ]
    const service = await buildService({ githubClientFor: async () => fakeGithubClient(comments) })

    const prompt = service.standardReviewPrompt()

    expect(prompt).toContain('## Previous PR Comments')
    expect(prompt).toContain(`- **octo** app/x.rb:3: ${longBody.slice(0, 501)}\n`)
    expect(prompt).not.toContain(longBody.slice(0, 502))
    expect(prompt).toContain('- **reviewer** : General note')
    expect(service.swarmReviewPrompt()).toContain('## Previous PR Comments')
  })

  test('prompts omit the previous comments section when there are none', async () => {
    expect((await buildService()).standardReviewPrompt()).not.toContain('Previous PR Comments')
  })
})

describe('codex handling', () => {
  test('codex command args include output-last-message flag', async () => {
    const service = await buildService({ cliClient: 'codex' })

    const args = service.cmdArgsForReview()

    expect(args.slice(0, 4)).toEqual(['codex', 'exec', '--output-last-message', service.codexLastMessagePath()])
    expect(args[4]).toBe(service.reviewPrompt())
  })

  test('non-codex command args omit output-last-message flag', async () => {
    const service = await buildService()

    expect(service.cmdArgsForReview()).toEqual(['claude', '-p', service.reviewPrompt()])
  })

  test('clear_codex_last_message! deletes existing file for codex', async () => {
    const service = await buildService({ cliClient: 'codex' })
    const path = service.codexLastMessagePath()
    writeFileSync(path, 'old')

    service.clearCodexLastMessage()

    expect(existsSync(path)).toBe(false)
  })

  test('clear_codex_last_message! is a no-op for non-codex', async () => {
    const service = await buildService()
    const path = service.codexLastMessagePath()
    const content = 'kept'
    writeFileSync(path, content)

    service.clearCodexLastMessage()

    expect(readFileSync(path, 'utf8')).toBe(content)
  })

  test('normalize_output uses codex last message when available', async () => {
    const lastMessage = '```json\n[]\n```'
    const service = await buildService({ cliClient: 'codex' })
    writeFileSync(service.codexLastMessagePath(), lastMessage)

    expect(service.normalizeOutput('header\nuser\nprompt\n')).toBe(lastMessage)
  })

  test('normalize_output falls back to raw output when codex file is blank', async () => {
    const rawOutput = 'raw output'
    const service = await buildService({ cliClient: 'codex' })
    writeFileSync(service.codexLastMessagePath(), '')

    expect(service.normalizeOutput(rawOutput)).toBe(rawOutput)
  })

  test('normalize_output returns raw output for non-codex', async () => {
    const rawOutput = 'raw output'

    expect((await buildService()).normalizeOutput(rawOutput)).toBe(rawOutput)
  })
})
