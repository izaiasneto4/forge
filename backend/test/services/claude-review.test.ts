import { describe, expect, test } from 'bun:test'
import { ClaudeReviewError, ClaudeReviewService, type ReviewRunner } from '../../src/services/claude-review'
import { CLIENTS, CodeReviewError, CodeReviewService } from '../../src/services/code-review'
import type { GithubCliClient } from '../../src/services/github-cli-client'
import { FakeCommandRunner } from '../support/context'

const pullRequest = { number: 456, title: 'Test PR', description: 'Test description', repoOwner: 'test', repoName: 'repo' }
const worktreePath = '/tmp/test-worktree'

const githubClient: GithubCliClient = {
  fetchPrComments: async () => [],
  reviewRequestedForMe: async () => false,
  latestMyReviewState: async () => null,
}

function createService() {
  return ClaudeReviewService.create({ commands: new FakeCommandRunner() }, { worktreePath, pullRequest, githubClientFor: async () => githubClient })
}

// Records calls and replays scripted lines, standing in for CodeReviewService.
class RecordingRunner implements ReviewRunner {
  runReviewCalls = 0
  streamingCalls = 0

  constructor(
    private readonly output = 'review output',
    private readonly lines: string[] = [],
  ) {}

  async runReview() {
    this.runReviewCalls += 1
    return this.output
  }

  async runReviewStreaming(onLine?: (line: string) => void) {
    this.streamingCalls += 1
    for (const line of this.lines) onLine?.(line)
    return this.output
  }
}

describe('ClaudeReviewService', () => {
  test('delegates to CodeReviewService.for with the claude client', async () => {
    const service = await createService()

    expect(service.service).toBeInstanceOf(CodeReviewService)
    expect(service.service).toMatchObject({ cliClient: 'claude', command: CLIENTS.claude.command, worktreePath })
  })

  test('run_review delegates to CodeReviewService', async () => {
    const output = 'review output'
    const runner = new RecordingRunner(output)

    const result = await new ClaudeReviewService(runner).runReview()

    expect(runner.runReviewCalls).toBe(1)
    expect(result).toBe(output)
  })

  test('run_review_streaming delegates to CodeReviewService', async () => {
    const lines = ['line 1', 'line 2', 'line 3']
    const runner = new RecordingRunner('', lines)
    const collected: string[] = []

    await new ClaudeReviewService(runner).runReviewStreaming((line) => collected.push(line))

    expect(runner.streamingCalls).toBe(1)
    expect(collected).toEqual(lines)
  })

  test('run_review_streaming works without block', async () => {
    const runner = new RecordingRunner('', ['ignored'])

    await new ClaudeReviewService(runner).runReviewStreaming()

    expect(runner.streamingCalls).toBe(1)
  })

  test('Error is aliased from CodeReviewService::Error', () => {
    expect(ClaudeReviewError).toBe(CodeReviewError)
  })

  test('multiple calls to run_review use same service instance', async () => {
    const runner = new RecordingRunner()
    const service = new ClaudeReviewService(runner)

    await service.runReview()
    await service.runReview()

    expect(runner.runReviewCalls).toBe(2)
  })

  test('multiple calls to run_review_streaming use same service instance', async () => {
    const runner = new RecordingRunner()
    const service = new ClaudeReviewService(runner)

    await service.runReviewStreaming()
    await service.runReviewStreaming()

    expect(runner.streamingCalls).toBe(2)
  })
})
