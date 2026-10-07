import { isBlank, truncate } from '../lib/ruby'

// Port of ReviewOutputParser: pulls the first ```json block of review findings
// out of an AI CLI's output. Severity collapses to error / warning / info.
export type ReviewItemSeverity = 'error' | 'warning' | 'info'

export interface ReviewItem {
  title: string
  severity: ReviewItemSeverity
  file: string
  lines: string | null
  comment: string
  suggestedFix: string
}

const JSON_BLOCK = /```json\s*\n([\s\S]*?)\n```/

function rubyToString(value: unknown) {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

function normalizeSeverity(severity: unknown): ReviewItemSeverity {
  const value = rubyToString(severity).toLowerCase()
  if (value === 'error' || value === 'critical' || value === 'bug') return 'error'
  if (value === 'warning' || value === 'issue' || value === 'concern') return 'warning'
  return 'info'
}

function normalizeFilePath(file: unknown) {
  const path = rubyToString(file).trim()
  if (path === '' || path.toLowerCase().startsWith('unknown')) return 'N/A'
  return path
}

function titleFromComment(comment: unknown) {
  const text = rubyToString(comment)
  if (isBlank(text)) return 'Review finding'
  const firstSentence = (text.split(/[.!?\n]/)[0] ?? '').trim()
  return truncate(firstSentence, 60)
}

function toReviewItem(entry: unknown): ReviewItem | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
  const item: Record<string, unknown> = { ...entry }
  const title = rubyToString(item.title)
  return {
    title: isBlank(title) ? titleFromComment(item.comment) : title,
    severity: normalizeSeverity(item.severity),
    file: normalizeFilePath(item.file),
    lines: item.lines === null || item.lines === undefined ? null : rubyToString(item.lines),
    comment: rubyToString(item.comment),
    suggestedFix: rubyToString(item.suggested_fix),
  }
}

export function parseReviewOutput(output: string | null | undefined): ReviewItem[] {
  const match = JSON_BLOCK.exec(output ?? '')
  const content = match?.[1]?.trim()
  if (content === undefined) return []

  try {
    const data: unknown = JSON.parse(content)
    if (!Array.isArray(data)) return []
    return data.map(toReviewItem).filter((item) => item !== null)
  } catch {
    return []
  }
}
