import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from '../context'
import { logger } from '../lib/logger'
import { isBlank, isPresent } from '../lib/ruby'
import { isCliClient, type CliClient } from '../models/setting'
import { isDirectory } from './git'
import type { GithubCliClient, PullRequestComment, PullRequestRef } from './github-cli-client'
import { detectModel } from './model-detector'

// Port of CodeReviewService: runs an AI CLI (claude/codex/opencode) inside a
// PR worktree with the review prompt and returns its output.
export class CodeReviewError extends Error {}

export interface CliClientConfig {
  command: string
  args: string[]
  skill: string | null
}

export const CLIENTS: Record<CliClient, CliClientConfig> = {
  claude: { command: 'claude', args: ['-p'], skill: '/code-review' },
  codex: { command: 'codex', args: ['exec'], skill: null },
  opencode: { command: 'opencode', args: ['run'], skill: null },
}

export interface ReviewPullRequest extends PullRequestRef {
  title: string | null
  description: string | null
}

export type GithubClientFactory = (repoPath: string) => Promise<GithubCliClient>

export interface CodeReviewOptions {
  cliClient: string
  worktreePath: string
  pullRequest: ReviewPullRequest
  reviewType?: string
  // `GithubCliService.new(repo_path:)`, used to load the PR's existing comments.
  githubClientFor: GithubClientFactory
}

interface CodeReviewSettings extends CliClientConfig {
  cliClient: string
  worktreePath: string
  pullRequest: ReviewPullRequest
  reviewType: string
  previousComments: PullRequestComment[]
}

const FENCE = '```'

// Previous comments only add context, so any failure just means none.
async function fetchPreviousComments(worktreePath: string, pullRequest: ReviewPullRequest, githubClientFor: GithubClientFactory) {
  try {
    const client = await githubClientFor(worktreePath)
    return await client.fetchPrComments(pullRequest)
  } catch (error) {
    logger.warn(`Failed to fetch previous comments: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

// Ruby `str[0..500]`: the first 501 characters (code points, not UTF-16 units).
function firstCharacters(text: string, count: number) {
  return Array.from(text).slice(0, count).join('')
}

export class CodeReviewService {
  readonly cliClient: string
  readonly command: string
  readonly args: string[]
  readonly skill: string | null
  readonly worktreePath: string
  readonly pullRequest: ReviewPullRequest
  readonly reviewType: string
  readonly previousComments: PullRequestComment[]

  // `CodeReviewService.for`: unknown clients fall back to the claude command.
  static async for(ctx: Pick<AppContext, 'commands'>, options: CodeReviewOptions) {
    const config = isCliClient(options.cliClient) ? CLIENTS[options.cliClient] : CLIENTS.claude
    const previousComments = await fetchPreviousComments(options.worktreePath, options.pullRequest, options.githubClientFor)
    return new CodeReviewService(ctx, {
      ...config,
      cliClient: options.cliClient,
      worktreePath: options.worktreePath,
      pullRequest: options.pullRequest,
      reviewType: options.reviewType ?? 'review',
      previousComments,
    })
  }

  constructor(
    private readonly ctx: Pick<AppContext, 'commands'>,
    settings: CodeReviewSettings,
  ) {
    this.cliClient = settings.cliClient
    this.command = settings.command
    this.args = settings.args
    this.skill = settings.skill
    this.worktreePath = settings.worktreePath
    this.pullRequest = settings.pullRequest
    this.reviewType = settings.reviewType
    this.previousComments = settings.previousComments
  }

  detectModel() {
    return detectModel(this.cliClient)
  }

  // Open3.popen3: separate stdout/stderr; a failed exit only raises when it
  // produced no output.
  async runReview() {
    this.validateWorktree()
    this.clearCodexLastMessage()

    const result = await this.ctx.commands.run(this.cmdArgsForReview(), { cwd: this.worktreePath })
    const output = this.normalizeOutput(result.stdout)

    if (!result.success) {
      logger.error(`${this.command} review error: ${result.stderr}`)
      if (isBlank(output)) throw new CodeReviewError(`${this.command} review failed: ${result.stderr}`)
    }
    return output
  }

  // Open3.popen2e: combined output streamed line by line; the exit status is
  // ignored (the job validates the output instead).
  async runReviewStreaming(onLine?: (line: string) => void) {
    this.validateWorktree()
    this.clearCodexLastMessage()

    const rawOutput: string[] = []
    await this.ctx.commands.run(this.cmdArgsForReview(), {
      cwd: this.worktreePath,
      onOutputLine: (line) => {
        rawOutput.push(line)
        onLine?.(line)
      },
    })
    return this.normalizeOutput(rawOutput.join(''))
  }

  reviewPrompt() {
    return this.reviewType === 'swarm' ? this.swarmReviewPrompt() : this.standardReviewPrompt()
  }

  cmdArgsForReview() {
    const baseArgs = [this.command, ...this.args]
    if (!this.isCodexClient()) return [...baseArgs, this.reviewPrompt()]
    return [...baseArgs, '--output-last-message', this.codexLastMessagePath(), this.reviewPrompt()]
  }

  codexLastMessagePath() {
    return join(this.worktreePath, '.forge_codex_last_message.md')
  }

  clearCodexLastMessage() {
    if (!this.isCodexClient()) return
    const path = this.codexLastMessagePath()
    if (existsSync(path)) unlinkSync(path)
  }

  // codex echoes the prompt to stdout; its final answer is written to the
  // --output-last-message file, which wins when present.
  normalizeOutput(rawOutput: string) {
    if (!this.isCodexClient()) return rawOutput
    const path = this.codexLastMessagePath()
    const fileOutput = existsSync(path) ? readFileSync(path, 'utf8') : ''
    return isPresent(fileOutput) ? fileOutput : rawOutput
  }

  previousCommentsContext() {
    if (this.previousComments.length === 0) return ''

    const lines = this.previousComments
      .map((comment) => {
        const location = comment.path === null ? '' : `${comment.path}:${comment.line ?? ''}`
        return `- **${comment.author ?? ''}** ${location}: ${firstCharacters(comment.body ?? '', 501)}`
      })
      .join('\n')

    return `\n## Previous PR Comments\n\nThe following comments exist on this PR from previous reviews:\n\n${lines}\n\n`
  }

  standardReviewPrompt() {
    const skillInstruction = this.skill ? `Run ${this.skill} to analyze the changes.` : 'Analyze the code changes.'

    return `Review PR #${this.pullRequest.number ?? ''}: ${this.pullRequest.title ?? ''}

${this.pullRequest.description ?? ''}

${this.previousCommentsContext()}
IMPORTANT SCOPE CONSTRAINT: You must ONLY review code that was actually changed in this PR.
- Use \`gh pr diff\` or \`git diff\` to identify exactly which files and lines were modified
- Do NOT flag issues in pre-existing code that wasn't touched by this PR
- Do NOT review or comment on files that weren't modified in this PR
- Only flag issues on lines that were added or modified, not surrounding unchanged code

Focus your review on:
- Code quality and best practices (only in changed code)
- Potential bugs or issues introduced by this PR
- Security concerns in the new/modified code
- Performance implications of the changes

${skillInstruction}

After completing the review, you MUST output your findings as a JSON array wrapped in ${FENCE}json code block.
Each item in the array should have this exact structure:
{
  "title": "Brief, actionable title of the issue (max 10 words)",
  "severity": "error" | "warning" | "info",
  "file": "path/to/file.ext",
  "lines": "10-20" or "10" or null,
  "comment": "Detailed description of the issue in markdown",
  "suggested_fix": "Code suggestion if applicable, or null"
}

IMPORTANT suggested_fix rules:
- Use \`suggested_fix\` ONLY for concrete replacement code/snippets that can be copied into source
- If you only have advice/explanation (no code), put it in \`comment\` and set \`suggested_fix\` to null
- Do NOT put prose, rationale, or instructions in \`suggested_fix\`

IMPORTANT: The "file" field MUST be the actual file path from the repository (e.g., "app/models/user.rb").
- If you cannot determine the exact file path, use "N/A" instead of "unknown" or placeholder text
- Never include explanatory text like "unknown (ClassName)" in the file field
- The file path should be relative to the repository root

Example output format:
${FENCE}json
[
  {
    "severity": "warning",
    "file": "src/components/ItemList.tsx",
    "lines": "45-50",
    "comment": "Sequential awaits inside loop. For many items, this is slow.\\n\\n**Suggestion:** Use \`Promise.all()\` or batch operations.",
    "suggested_fix": "await Promise.all(items.map((item) => processItem(item)));"
  }
]
${FENCE}

IMPORTANT: Replace the example values above with actual data from the PR you are reviewing.

IMPORTANT: Always wrap the JSON in ${FENCE}json code fences. If no issues found, return an empty array: ${FENCE}json\\n[]\\n${FENCE}
`
  }

  swarmReviewPrompt() {
    return `# Deep Code Review - Multi-Agent Analysis

You are orchestrating a comprehensive code review using 7 specialized reviewer agents. Your job is to:
1. Invoke each specialized reviewer
2. Collect all findings
3. Consolidate by consensus and priority
4. Return structured findings for automated UI mapping

## Target for Review

PR #${this.pullRequest.number ?? ''}: ${this.pullRequest.title ?? ''}

${this.pullRequest.description ?? ''}

${this.previousCommentsContext()}
Review the changes in this PR. Use \`gh pr diff\` or \`git diff\` to identify exactly which files and lines were modified.

## Step 1: Invoke Specialized Reviewers

Call each of these 7 specialized reviewers to analyze the code using the Task tool with parallel agents:

1. **Security Reviewer** - Analyze for security vulnerabilities (OWASP, auth, secrets, etc.)
2. **Data Consistency Reviewer** - Detect data mismatches, inconsistencies across data sources, and calculation discrepancies
3. **Code Smell Reviewer** - Detect code smells and clean code violations
4. **Design Pattern Reviewer** - Review architecture and design patterns (SOLID, anti-patterns)
5. **Performance Reviewer** - Identify performance issues and optimization opportunities
6. **Maintainability Reviewer** - Assess maintainability, readability, and technical debt
7. **Regression Reviewer** - Detect behavioral regressions, ensuring code changes don't break existing functionality

For each reviewer, ask them to analyze the target code and return their findings in the specified format.

## Step 2: Consolidate Findings

After receiving all reviews, consolidate the findings:

### Consensus Rules
- **CRITICAL**: Issues flagged as CRITICAL by ANY reviewer
- **HIGH**: Issues flagged as HIGH by 2+ reviewers OR HIGH by 1 reviewer + related findings
- **MEDIUM**: Issues flagged by 2+ reviewers at any level
- **LOW**: Single reviewer findings not meeting above criteria

### Deduplication
- Merge similar issues across reviewers
- Note when multiple reviewers identified the same issue (strengthens priority)
- Combine recommendations from different perspectives

## Step 3: Return Structured Output

After consolidation, you MUST output your findings as a JSON array wrapped in ${FENCE}json code block.
Each item in the array should have this exact structure:
{
  "title": "Brief, actionable title of the issue (max 10 words)",
  "severity": "error" | "warning" | "info",
  "file": "path/to/file.ext",
  "lines": "10-20" or "10" or null,
  "comment": "Detailed description of the issue in markdown",
  "suggested_fix": "Code suggestion if applicable, or null"
}

IMPORTANT suggested_fix rules:
- Use \`suggested_fix\` ONLY for concrete replacement code/snippets that can be copied into source
- If you only have advice/explanation (no code), put it in \`comment\` and set \`suggested_fix\` to null
- Do NOT put prose, rationale, or instructions in \`suggested_fix\`

IMPORTANT: The "file" field MUST be the actual file path from the repository.
- If you cannot determine the exact file path, use "N/A"
- Never include explanatory text like "unknown (ClassName)" in the file field

If no issues are found, return:
${FENCE}json
[]
${FENCE}

## Important Notes

- Be thorough but avoid false positives
- Prioritize real issues over theoretical concerns
- Include enough context for another agent to implement fixes
- The report should be actionable, not just informational
`
  }

  private validateWorktree() {
    if (!isDirectory(this.worktreePath)) throw new CodeReviewError(`Worktree path not found: ${this.worktreePath}`)
  }

  private isCodexClient() {
    return this.cliClient === 'codex'
  }
}
