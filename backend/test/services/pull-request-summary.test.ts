import { beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { findSnapshot, parseStringArray, type PullRequestSnapshotRecord } from '../../src/models/pull-request-snapshot'
import type { PullRequestRecord } from '../../src/models/pull-request'
import { SettingStore } from '../../src/models/setting'
import {
  chunkDiff,
  chunkPrompt,
  consolidationPrompt,
  generatePullRequestSummary,
  integerOrNil,
  MAX_CHUNK_CHARS,
  MAX_ITEMS_PER_LIST,
  normalizeStringArray,
  parseJsonObject,
  PullRequestSummaryError,
} from '../../src/services/pull-request-summary'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest, insertSnapshot } from '../support/factories'

const metrics = { changedFiles: 6, additions: 210, deletions: 34 }

function fenced(value: object) {
  return `\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`
}

let ctx: TestContext
let pullRequest: PullRequestRecord
let snapshot: PullRequestSnapshotRecord

beforeEach(() => {
  ctx = createTestContext()
  pullRequest = insertPullRequest(ctx.db, {
    number: 42,
    title: 'Summary target',
    repoOwner: 'acme',
    repoName: 'api',
    headSha: 'head-1',
    baseSha: 'base-1',
    ...metrics,
  })
  snapshot = insertSnapshot(ctx.db, { pullRequestId: pullRequest.id, headSha: 'head-1', baseSha: 'base-1', aiSummaryStatus: 'pending' })
})

function stubDiff(diff: string) {
  ctx.commands.on(['gh', 'pr', 'diff'], { stdout: diff })
}

function stubAiOutputs(command: string[], outputs: string[]) {
  const remaining = [...outputs]
  ctx.commands.on(command, () => ({ stdout: remaining.shift() ?? '' }))
}

function reloadSnapshot() {
  return findSnapshot(ctx.db, snapshot.id)
}

describe('generatePullRequestSummary', () => {
  test('analyses each chunk, consolidates, and stores the summary', async () => {
    const line = '+cache update\n'
    const largeDiff = line.repeat(1500)
    const chunkCount = chunkDiff(largeDiff).length
    const finalMainChanges = ['Caching layer added', 'Auth middleware refactor']
    const finalRiskAreas = ['Billing calculation', 'Authentication logic']
    stubDiff(largeDiff)
    stubAiOutputs(
      ['claude', '-p'],
      [
        fenced({ main_changes: ['Caching layer added'], risk_areas: ['Authentication logic'] }),
        fenced({ main_changes: ['Auth middleware refactor'], risk_areas: ['Billing calculation'] }),
        fenced({ files_changed: 6, lines_added: 210, lines_removed: 34, main_changes: finalMainChanges, risk_areas: finalRiskAreas }),
      ],
    )

    const summary = await generatePullRequestSummary(ctx, snapshot, { cliClient: 'claude' })

    const stored = reloadSnapshot()
    expect(ctx.commands.commandsMatching(['claude', '-p'])).toHaveLength(chunkCount + 1)
    expect(stored.aiSummaryStatus).toBe('current')
    expect(stored.aiSummaryGeneratedAt).toBeInstanceOf(Date)
    expect(summary.filesChanged).toBe(metrics.changedFiles)
    expect(summary.mainChanges).toEqual(finalMainChanges)
    expect(summary.riskAreas).toEqual(finalRiskAreas)
    expect(parseStringArray(stored.aiSummaryMainChanges)).toEqual(finalMainChanges)
    expect(parseStringArray(stored.aiSummaryRiskAreas)).toEqual(finalRiskAreas)
    expect(stored.aiSummaryLinesAdded).toBe(metrics.additions)
  })

  test('marks the snapshot failed when the AI output is malformed', async () => {
    stubDiff('+bad change\n')
    stubAiOutputs(['claude', '-p'], ['not json'])

    await expect(generatePullRequestSummary(ctx, snapshot, { cliClient: 'claude' })).rejects.toBeInstanceOf(PullRequestSummaryError)

    const stored = reloadSnapshot()
    expect(stored.aiSummaryStatus).toBe('failed')
    expect(stored.aiSummaryFailureReason).toMatch(/parse failed/i)
  })

  test('fetches the diff with gh for the PR repo', async () => {
    stubDiff('+x\n')
    stubAiOutputs(['claude', '-p'], [fenced({ main_changes: ['x'] }), fenced({ main_changes: ['x'] })])

    await generatePullRequestSummary(ctx, snapshot, { cliClient: 'claude' })

    expect(ctx.commands.commandsMatching(['gh'])[0]?.command).toEqual([
      'gh',
      'pr',
      'diff',
      String(pullRequest.number),
      '--repo',
      `${pullRequest.repoOwner}/${pullRequest.repoName}`,
    ])
  })

  test('fails with the gh error when the diff cannot be fetched', async () => {
    const stderr = 'could not find pull request'
    ctx.commands.on(['gh', 'pr', 'diff'], { success: false, stderr })

    await expect(generatePullRequestSummary(ctx, snapshot)).rejects.toThrow(stderr)

    expect(reloadSnapshot().aiSummaryFailureReason).toBe(stderr)
  })

  test('falls back to a generic message when gh fails silently', async () => {
    ctx.commands.on(['gh', 'pr', 'diff'], { success: false })

    await expect(generatePullRequestSummary(ctx, snapshot)).rejects.toThrow('Failed to fetch PR diff')
  })

  test('fails on an empty diff', async () => {
    stubDiff('  \n')

    await expect(generatePullRequestSummary(ctx, snapshot)).rejects.toThrow('PR diff is empty')

    expect(reloadSnapshot().aiSummaryStatus).toBe('failed')
  })

  test('fails when the consolidated summary has no main changes', async () => {
    stubDiff('+x\n')
    stubAiOutputs(['claude', '-p'], [fenced({ main_changes: ['x'] }), fenced({ main_changes: [' ', ''] })])

    await expect(generatePullRequestSummary(ctx, snapshot, { cliClient: 'claude' })).rejects.toThrow('Summary output missing main changes')
  })

  test('fails when the AI command fails', async () => {
    const stderr = 'claude: not logged in'
    stubDiff('+x\n')
    ctx.commands.on(['claude', '-p'], { success: false, stderr })

    await expect(generatePullRequestSummary(ctx, snapshot, { cliClient: 'claude' })).rejects.toThrow(stderr)
  })

  test('fails when the AI command succeeds without output', async () => {
    stubDiff('+x\n')
    ctx.commands.on(['claude', '-p'], { stdout: '' })

    await expect(generatePullRequestSummary(ctx, snapshot, { cliClient: 'claude' })).rejects.toThrow('AI summary command failed')
  })

  test('uses the AI metrics only when the pull request has none', async () => {
    const aiMetrics = { files_changed: 3, lines_added: '12', lines_removed: 'many' }
    const bare = insertPullRequest(ctx.db, { changedFiles: null, additions: null, deletions: null })
    const bareSnapshot = insertSnapshot(ctx.db, { pullRequestId: bare.id })
    stubDiff('+x\n')
    stubAiOutputs(['claude', '-p'], [fenced({ main_changes: ['x'] }), fenced({ ...aiMetrics, main_changes: ['x'] })])

    const summary = await generatePullRequestSummary(ctx, bareSnapshot, { cliClient: 'claude' })

    expect(summary.filesChanged).toBe(aiMetrics.files_changed)
    expect(summary.linesAdded).toBe(Number(aiMetrics.lines_added))
    expect(summary.linesRemoved).toBeNull()
  })

  test('uses the default CLI client from settings', async () => {
    new SettingStore(ctx.db).setDefaultCliClient('opencode')
    stubDiff('+x\n')
    stubAiOutputs(['opencode', 'run'], [fenced({ main_changes: ['x'] }), fenced({ main_changes: ['x'] })])

    await generatePullRequestSummary(ctx, snapshot)

    expect(ctx.commands.commandsMatching(['opencode', 'run'])).toHaveLength(2)
  })

  test('reads codex output from the last-message file and removes it', async () => {
    const outputPaths: string[] = []
    const responses = [fenced({ main_changes: ['from file'] }), fenced({ main_changes: ['from file'] })]
    stubDiff('+x\n')
    ctx.commands.on(['codex', 'exec', '--output-last-message'], (command) => {
      const outputPath = command[3] ?? ''
      outputPaths.push(outputPath)
      writeFileSync(outputPath, responses.shift() ?? '')
      return { stdout: 'codex transcript' }
    })

    const summary = await generatePullRequestSummary(ctx, snapshot, { cliClient: 'codex' })

    expect(summary.mainChanges).toEqual(['from file'])
    expect(outputPaths.every((path) => /forge-pr-summary-[0-9a-f]{12}\.md$/.test(path) && !existsSync(path))).toBe(true)
  })

  test('accepts codex stdout when it fails without writing the file', async () => {
    const output = fenced({ main_changes: ['from stdout'] })
    stubDiff('+x\n')
    ctx.commands.on(['codex', 'exec'], { success: false, stdout: output })

    const summary = await generatePullRequestSummary(ctx, snapshot, { cliClient: 'codex' })

    expect(summary.mainChanges).toEqual(['from stdout'])
  })

  test('fails for an archived pull request, like the default-scoped association', async () => {
    const archived = insertPullRequest(ctx.db, { archived: true })
    const archivedSnapshot = insertSnapshot(ctx.db, { pullRequestId: archived.id })

    await expect(generatePullRequestSummary(ctx, archivedSnapshot)).rejects.toBeInstanceOf(PullRequestSummaryError)

    expect(findSnapshot(ctx.db, archivedSnapshot.id).aiSummaryStatus).toBe('failed')
    expect(ctx.commands.calls).toHaveLength(0)
  })
})

describe('prompts', () => {
  test('the chunk prompt embeds the PR, chunk index and diff', () => {
    const chunk = '+added line\n'
    const index = 2

    const prompt = chunkPrompt(pullRequest, chunk, index)

    expect(prompt).toContain(`Pull request: #${pullRequest.number} ${pullRequest.title}\nChunk: ${index}\n`)
    expect(prompt).toContain(`\`\`\`diff\n${chunk}\n\`\`\`\n`)
    expect(prompt).toContain(`Return at most ${MAX_ITEMS_PER_LIST} items for each array.`)
  })

  test('the consolidation prompt lists metrics and pretty-printed chunk notes', () => {
    const chunkResults = [{ main_changes: ['a'], risk_areas: [] }]

    const prompt = consolidationPrompt(pullRequest, chunkResults)

    expect(prompt).toContain(`"files_changed": ${metrics.changedFiles},`)
    expect(prompt).toContain(`- lines_removed: ${metrics.deletions}\n`)
    expect(prompt).toContain(`\`\`\`json\n${JSON.stringify(chunkResults, null, 2)}\n\`\`\`\n`)
  })

  test('the consolidation prompt shows missing metrics as 0 and nil', () => {
    const bare = insertPullRequest(ctx.db, { changedFiles: null })

    const prompt = consolidationPrompt(bare, [])

    expect(prompt).toContain('"files_changed": 0,')
    expect(prompt).toContain('- files_changed: nil\n')
  })
})

describe('helpers', () => {
  test('chunkDiff packs whole lines up to the limit', () => {
    const line = '+cache update\n'
    const linesPerChunk = Math.floor(MAX_CHUNK_CHARS / line.length)
    const totalLines = 1500

    const chunks = chunkDiff(line.repeat(totalLines))

    expect(chunks.map((chunk) => chunk.length / line.length)).toEqual([linesPerChunk, totalLines - linesPerChunk])
  })

  test('chunkDiff keeps an oversized line whole and drops blank input', () => {
    const longLine = `+${'x'.repeat(MAX_CHUNK_CHARS + 10)}\n`

    expect(chunkDiff(longLine)).toEqual([longLine])
    expect(chunkDiff('')).toEqual([])
  })

  test('normalizeStringArray strips, drops blanks, dedupes and caps the list', () => {
    const items = [' a ', 'a', '', 'b', 'c', 'd', 'e', 'f']

    expect(normalizeStringArray(items)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  test('normalizeStringArray wraps scalars and treats null as empty', () => {
    const scalar = 'only item'

    expect(normalizeStringArray(scalar)).toEqual([scalar])
    expect(normalizeStringArray(null)).toEqual([])
  })

  const integerCases: Array<[unknown, number | null]> = [
    [6, 6],
    [6.7, 6],
    [' 12 ', 12],
    ['0x1A', 26],
    ['010', 8],
    ['1_000', 1000],
    ['-5', -5],
    ['6.5', null],
    ['many', null],
    [null, null],
    [true, null],
  ]
  test.each(integerCases)('integerOrNil(%p) is %p', (value, expected) => {
    expect(integerOrNil(value)).toBe(expected)
  })

  test('parseJsonObject reads the fenced block, or the whole text', () => {
    const data = { main_changes: ['x'] }

    expect(parseJsonObject(`noise\n${fenced(data)}more noise`)).toEqual(data)
    expect(parseJsonObject(JSON.stringify(data))).toEqual(data)
  })

  test('parseJsonObject rejects non-object JSON', () => {
    expect(() => parseJsonObject('[1, 2]')).toThrow('AI summary output must be a JSON object')
  })
})
