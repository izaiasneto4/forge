import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { AppContext } from '../context'
import { pullRequests } from '../db/schema'
import { isBlank, isPresent } from '../lib/ruby'
import { findPullRequestBy, repoFullName, type PullRequestRecord } from '../models/pull-request'
import {
  markAiSummaryFailed,
  storeAiSummary,
  type PullRequestSnapshotRecord,
  type StoredAiSummary,
} from '../models/pull-request-snapshot'
import { SettingStore } from '../models/setting'

// Port of PullRequestSummaryService: an AI "what changed / where's the risk"
// summary of a PR diff, analysed in chunks and then consolidated.

export class PullRequestSummaryError extends Error {}

const JSON_BLOCK_REGEX = /```json\s*\n([\s\S]*?)\n```/
export const MAX_CHUNK_CHARS = 12_000
export const MAX_ITEMS_PER_LIST = 5

export interface ChunkResult {
  main_changes: string[]
  risk_areas: string[]
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// Ruby `presence` chain: the first non-blank value.
function firstPresent(...values: Array<string | null>) {
  return values.find((value) => isPresent(value)) ?? null
}

async function fetchDiff(ctx: AppContext, pullRequest: PullRequestRecord) {
  const result = await ctx.commands.run(['gh', 'pr', 'diff', String(pullRequest.number ?? ''), '--repo', repoFullName(pullRequest)])
  if (!result.success) {
    throw new PullRequestSummaryError(firstPresent(result.stderr, result.stdout) ?? 'Failed to fetch PR diff')
  }
  return result.stdout
}

// Ruby measures strings in characters, not UTF-16 code units.
function characterCount(text: string) {
  return text.length - (text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0)
}

// `each_line`-based packing: whole lines, at most MAX_CHUNK_CHARS per chunk
// unless a single line is longer. Blank chunks are never emitted.
export function chunkDiff(diff: string) {
  const chunks: string[] = []
  let current = ''
  let currentLength = 0
  for (const line of diff.split(/(?<=\n)/)) {
    const lineLength = characterCount(line)
    if (currentLength + lineLength > MAX_CHUNK_CHARS && isPresent(current)) {
      chunks.push(current)
      current = ''
      currentLength = 0
    }
    current += line
    currentLength += lineLength
  }
  if (isPresent(current)) chunks.push(current)
  return chunks
}

export function chunkPrompt(pullRequest: PullRequestRecord, chunk: string, index: number) {
  return `You are analyzing a GitHub pull request diff chunk.

Return only a JSON object wrapped in \`\`\`json fences with this exact shape:
{
  "main_changes": ["short phrase"],
  "risk_areas": ["short phrase"]
}

Rules:
- Be concise.
- \`main_changes\` should list concrete code changes from this diff chunk.
- \`risk_areas\` should list areas where bugs/regressions are most likely.
- Return at most ${MAX_ITEMS_PER_LIST} items for each array.
- If a list has no items, return an empty array.

Pull request: #${pullRequest.number ?? ''} ${pullRequest.title ?? ''}
Chunk: ${index}

\`\`\`diff
${chunk}
\`\`\`
`
}

// Ruby `Integer#inspect` / `nil.inspect`.
function inspectMetric(value: number | null) {
  return value === null ? 'nil' : String(value)
}

export function consolidationPrompt(pullRequest: PullRequestRecord, chunkResults: ChunkResult[]) {
  return `Consolidate these per-chunk pull request notes into one reviewer-facing summary.

Return only a JSON object wrapped in \`\`\`json fences with this exact shape:
{
  "files_changed": ${pullRequest.changedFiles ?? 0},
  "lines_added": ${pullRequest.additions ?? 0},
  "lines_removed": ${pullRequest.deletions ?? 0},
  "main_changes": ["short phrase"],
  "risk_areas": ["short phrase"]
}

Rules:
- Prefer the provided metrics unless they are null.
- \`main_changes\` must contain at least 1 item.
- \`risk_areas\` can be empty.
- Deduplicate repeated points.
- Keep each item short and reviewer-oriented.
- Return at most ${MAX_ITEMS_PER_LIST} items per array.

Canonical metrics:
- files_changed: ${inspectMetric(pullRequest.changedFiles)}
- lines_added: ${inspectMetric(pullRequest.additions)}
- lines_removed: ${inspectMetric(pullRequest.deletions)}

Chunk analysis:
\`\`\`json
${JSON.stringify(chunkResults, null, 2)}
\`\`\`
`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Ruby `to_s` for JSON scalars; nested arrays/objects fall back to JSON text.
function itemText(item: unknown): string {
  if (item === null || item === undefined) return ''
  if (typeof item === 'string') return item
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  return JSON.stringify(item)
}

// `Array(value)`: nil is [], a hash becomes its [key, value] pairs, a scalar is wrapped.
function rubyArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value
  if (isRecord(value)) return Object.entries(value)
  return [value]
}

export function normalizeStringArray(value: unknown) {
  const items = rubyArray(value)
    .map((item) => itemText(item).trim())
    .filter((item) => !isBlank(item))
  return [...new Set(items)].slice(0, MAX_ITEMS_PER_LIST)
}

const RUBY_INTEGER = /^([+-]?)(0[xX][0-9a-fA-F]+(?:_[0-9a-fA-F]+)*|0[bB][01]+(?:_[01]+)*|0[oO]?[0-7]+(?:_[0-7]+)*|[1-9]\d*(?:_\d+)*|0)$/

// `Integer(value, exception: false)`.
export function integerOrNil(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value !== 'string') return null
  const match = RUBY_INTEGER.exec(value.trim())
  if (!match) return null
  const [, sign = '', digits = ''] = match
  const cleaned = digits.replaceAll('_', '')
  const magnitude = /^0[0-7]/.test(cleaned) ? Number.parseInt(cleaned.slice(1), 8) : Number(cleaned.replace(/^0[oO]/, '0o'))
  return sign === '-' ? -magnitude : magnitude
}

export function parseJsonObject(text: string | null): Record<string, unknown> {
  const content = text ?? ''
  const fenced = JSON_BLOCK_REGEX.exec(content)?.[1]
  let parsed: unknown
  try {
    parsed = JSON.parse((fenced ?? content).trim())
  } catch (error) {
    throw new PullRequestSummaryError(`AI summary output parse failed: ${errorText(error)}`)
  }
  if (!isRecord(parsed)) throw new PullRequestSummaryError('AI summary output must be a JSON object')
  return parsed
}

function normalizeChunkResult(data: Record<string, unknown>): ChunkResult {
  return { main_changes: normalizeStringArray(data.main_changes), risk_areas: normalizeStringArray(data.risk_areas) }
}

// The PR's own metrics win; the AI's numbers only fill gaps.
function normalizeFinalSummary(pullRequest: PullRequestRecord, data: Record<string, unknown>): StoredAiSummary {
  const summary = {
    filesChanged: pullRequest.changedFiles ?? integerOrNil(data.files_changed),
    linesAdded: pullRequest.additions ?? integerOrNil(data.lines_added),
    linesRemoved: pullRequest.deletions ?? integerOrNil(data.lines_removed),
    mainChanges: normalizeStringArray(data.main_changes),
    riskAreas: normalizeStringArray(data.risk_areas),
  }
  if (summary.mainChanges.length === 0) throw new PullRequestSummaryError('Summary output missing main changes')
  return summary
}

async function runCodexPrompt(ctx: AppContext, prompt: string) {
  const outputPath = join(tmpdir(), `forge-pr-summary-${randomBytes(6).toString('hex')}.md`)
  const result = await ctx.commands.run(['codex', 'exec', '--output-last-message', outputPath, prompt])
  const content = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : result.stdout
  rmSync(outputPath, { force: true })
  if (!result.success && !isPresent(content)) {
    throw new PullRequestSummaryError(firstPresent(result.stderr, result.stdout) ?? 'AI summary command failed')
  }
  return content
}

async function runAiPrompt(ctx: AppContext, cliClient: string, prompt: string) {
  if (cliClient === 'codex') return runCodexPrompt(ctx, prompt)

  const command = cliClient === 'opencode' ? ['opencode', 'run', prompt] : ['claude', '-p', prompt]
  const result = await ctx.commands.run(command)
  if (!result.success || !isPresent(result.stdout)) {
    throw new PullRequestSummaryError(firstPresent(result.stderr, result.stdout) ?? 'AI summary command failed')
  }
  return result.stdout
}

async function summarize(ctx: AppContext, pullRequest: PullRequestRecord | undefined, cliClient: string) {
  // Rails' `snapshot.pull_request` is default-scoped, so an archived or deleted
  // PR fails the summary instead of summarizing it.
  if (!pullRequest) throw new PullRequestSummaryError('Pull request not found')

  const diff = await fetchDiff(ctx, pullRequest)
  if (isBlank(diff)) throw new PullRequestSummaryError('PR diff is empty')

  const chunkResults: ChunkResult[] = []
  for (const [index, chunk] of chunkDiff(diff).entries()) {
    const output = await runAiPrompt(ctx, cliClient, chunkPrompt(pullRequest, chunk, index + 1))
    chunkResults.push(normalizeChunkResult(parseJsonObject(output)))
  }

  const consolidated = await runAiPrompt(ctx, cliClient, consolidationPrompt(pullRequest, chunkResults))
  return normalizeFinalSummary(pullRequest, parseJsonObject(consolidated))
}

// `PullRequestSummaryService#generate!`: stores the summary on the snapshot, or
// marks it failed with the error message and re-raises.
export async function generatePullRequestSummary(
  ctx: AppContext,
  snapshot: PullRequestSnapshotRecord,
  options: { cliClient?: string | null } = {},
): Promise<StoredAiSummary> {
  const pullRequest = findPullRequestBy(ctx.db, eq(pullRequests.id, snapshot.pullRequestId))
  const cliClient = isPresent(options.cliClient) ? options.cliClient : new SettingStore(ctx.db).defaultCliClient()

  try {
    const summary = await summarize(ctx, pullRequest, cliClient)
    storeAiSummary(ctx.db, snapshot, summary)
    return summary
  } catch (error) {
    markAiSummaryFailed(ctx.db, snapshot, errorText(error))
    throw error
  }
}
