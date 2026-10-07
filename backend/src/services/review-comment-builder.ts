import { extname } from 'node:path'
import type { AppContext } from '../context'
import type { Db } from '../db/client'
import { RecordInvalidError } from '../lib/errors'
import { logger } from '../lib/logger'
import { isBlank, isPresent } from '../lib/ruby'
import { transaction } from '../models/record'
import { createReviewComment, type ReviewCommentRecord, type Severity } from '../models/review-comment'
import { parseReviewOutput, type ReviewItemSeverity } from './review-output-parser'

// Port of ReviewCommentBuilder: turns the parsed findings of a review into
// ReviewComment rows.
export class ReviewCommentBuilderError extends Error {}

// A ReviewOutputParser item; nullable fields mirror what the Ruby struct allowed.
export interface BuildableReviewItem {
  title: string | null
  severity: string | null
  file: string
  lines: string | null
  comment: string | null
  suggestedFix: string | null
}

export const SEVERITY_MAP: Record<ReviewItemSeverity, Severity> = {
  error: 'critical',
  warning: 'major',
  info: 'suggestion',
}

// Flags a suggested_fix as code (fenced) rather than prose.
const CODE_SUGGESTION_REGEX = new RegExp(
  [
    String.raw`^\s*(def|class|module|function|const|let|var|if|for|while|switch|return|import|export|async|await|try|catch|raise|rescue|begin|end)\b`,
    String.raw`=>|==|!=|<=|>=|\+\+|--|\|\||&&|::`,
    String.raw`^\s*[@$]?[a-zA-Z_]\w*\s*[:=]\s*.+`,
    String.raw`[{};]`,
    String.raw`^\s*<\/?[a-zA-Z][^>]*>\s*$`,
  ].join('|'),
)
const SINGLE_CALL_REGEX = /^[\w.$]+\([^)]*\)$/
const FENCE = '```'

export const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  rb: 'ruby',
  js: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  cs: 'csharp',
  cpp: 'cpp',
  c: 'c',
  php: 'php',
  sh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  json: 'json',
  sql: 'sql',
}

// Ruby String#strip: whitespace plus NUL.
function rubyStrip(text: string) {
  return text.replace(/^[\0\t\n\v\f\r ]+|[\0\t\n\v\f\r ]+$/g, '')
}

// Ruby String#to_i: leading integer (underscores allowed), 0 when none.
function rubyToInteger(text: string) {
  const match = /^\s*([+-]?\d+(?:_\d+)*)/.exec(text)
  return match?.[1] ? Number.parseInt(match[1].replaceAll('_', ''), 10) : 0
}

// "10" and "10-20" both comment on their starting line.
export function parseLineNumber(lines: string | null | undefined): number | null {
  if (isBlank(lines)) return null
  return rubyToInteger(lines.split('-')[0] ?? '')
}

export function mapSeverity(severity: string | null | undefined): Severity {
  if (severity === 'error' || severity === 'warning' || severity === 'info') return SEVERITY_MAP[severity]
  return 'suggestion'
}

export function detectLanguageFromFile(filename: string | null | undefined) {
  if (isBlank(filename) || filename === 'N/A') return ''
  const extension = extname(filename).toLowerCase().replaceAll('.', '')
  return Object.hasOwn(EXTENSION_LANGUAGE_MAP, extension) ? (EXTENSION_LANGUAGE_MAP[extension] ?? '') : ''
}

export function isCodeSuggestion(suggestion: string | null | undefined) {
  if (isBlank(suggestion)) return false
  if (suggestion.includes(FENCE)) return true

  const lines = suggestion
    .split(/(?<=\n)/)
    .map(rubyStrip)
    .filter((line) => isPresent(line))
  if (lines.length === 0) return false

  if (lines.some((line) => CODE_SUGGESTION_REGEX.test(line))) return true
  const [onlyLine] = lines
  return lines.length === 1 && onlyLine !== undefined && SINGLE_CALL_REGEX.test(onlyLine)
}

// Code fixes become a fenced "Suggested fix" block; prose is appended as text.
export function buildCommentBody(item: Pick<BuildableReviewItem, 'comment' | 'suggestedFix' | 'file'>) {
  const body = item.comment ?? ''
  if (!isPresent(item.suggestedFix)) return body

  const suggestion = rubyStrip(item.suggestedFix)
  if (isBlank(suggestion)) return body

  if (isCodeSuggestion(suggestion)) {
    const codeBlock = `**Suggested fix:**\n${FENCE}${detectLanguageFromFile(item.file)}\n${suggestion}\n${FENCE}`
    return isPresent(body) ? `${body}\n\n${codeBlock}` : codeBlock
  }
  return [body, suggestion].filter((part) => isPresent(part)).join('\n\n')
}

export function createCommentFromItem(db: Db, reviewTaskId: number, item: BuildableReviewItem) {
  return createReviewComment(db, {
    reviewTaskId,
    title: item.title,
    filePath: item.file,
    lineNumber: parseLineNumber(item.lines),
    severity: mapSeverity(item.severity),
    body: buildCommentBody(item),
    status: 'pending',
  })
}

// All-or-nothing: one invalid finding rolls back the whole batch.
export function persistReviewItems(ctx: AppContext, reviewTaskId: number, items: BuildableReviewItem[] | null | undefined): ReviewCommentRecord[] {
  if (!items || items.length === 0) return []

  try {
    const created = transaction(ctx, (txCtx) => items.map((item) => createCommentFromItem(txCtx.db, reviewTaskId, item)))
    logger.info(`ReviewCommentBuilder: Created ${created.length} comments for ReviewTask #${reviewTaskId}`)
    return created
  } catch (error) {
    if (!(error instanceof RecordInvalidError)) throw error
    logger.error(`ReviewCommentBuilder: Failed to create comments: ${error.message}`)
    throw new ReviewCommentBuilderError(`Cannot persist review comments: ${error.message}`)
  }
}

// `ReviewCommentBuilder.persist_for_review_task(review_task)`
export function persistCommentsForReviewTask(ctx: AppContext, task: { id: number; reviewOutput: string | null }) {
  const items = isBlank(task.reviewOutput) ? [] : parseReviewOutput(task.reviewOutput)
  return persistReviewItems(ctx, task.id, items)
}
