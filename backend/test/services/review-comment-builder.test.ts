import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { reviewComments } from '../../src/db/schema'
import type { Severity } from '../../src/models/review-comment'
import {
  buildCommentBody,
  createCommentFromItem,
  detectLanguageFromFile,
  mapSeverity,
  parseLineNumber,
  persistCommentsForReviewTask,
  persistReviewItems,
  ReviewCommentBuilderError,
  type BuildableReviewItem,
} from '../../src/services/review-comment-builder'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest, insertReviewTask } from '../support/factories'

let ctx: TestContext
let reviewTaskId: number

function item(attributes: Partial<BuildableReviewItem> = {}): BuildableReviewItem {
  return { title: null, severity: 'error', file: 'test.rb', lines: '10', comment: 'Fix this', suggestedFix: null, ...attributes }
}

function storedComments() {
  return ctx.db.select().from(reviewComments).where(eq(reviewComments.reviewTaskId, reviewTaskId)).all()
}

beforeEach(() => {
  ctx = createTestContext()
  reviewTaskId = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id }).id
})

describe('persistReviewItems', () => {
  test('returns empty array when no items', () => {
    expect(persistReviewItems(ctx, reviewTaskId, [])).toEqual([])
  })

  test('returns empty array when items is nil', () => {
    expect(persistReviewItems(ctx, reviewTaskId, null)).toEqual([])
  })

  test('creates comments from items', () => {
    const first = item({ severity: 'error', file: 'test.rb', lines: '10', comment: 'Fix this bug', suggestedFix: 'fixed code' })
    const second = item({ severity: 'warning', file: 'other.rb', lines: '20-30', comment: 'Refactor this' })

    const result = persistReviewItems(ctx, reviewTaskId, [first, second])

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ filePath: first.file, lineNumber: 10, severity: 'critical' })
    expect(result[1]).toMatchObject({ filePath: second.file, lineNumber: 20, severity: 'major' })
    expect(storedComments()).toHaveLength(2)
  })

  test('raises Error on validation failure and rolls back', () => {
    const valid = item({ comment: 'Valid comment' })
    const invalid = item({ comment: '' })

    expect(() => persistReviewItems(ctx, reviewTaskId, [valid, invalid])).toThrow(ReviewCommentBuilderError)
    expect(() => persistReviewItems(ctx, reviewTaskId, [invalid])).toThrow("Cannot persist review comments: Validation failed: Body can't be blank")
    expect(storedComments()).toEqual([])
  })

  test('handles multiple items', () => {
    const items = Array.from({ length: 5 }, (_, index) => item({ file: `file${index}.rb`, lines: String(index), comment: `Comment ${index}` }))

    const result = persistReviewItems(ctx, reviewTaskId, items)

    expect(result).toHaveLength(items.length)
    items.forEach((expected, index) => {
      expect(result[index]).toMatchObject({ filePath: expected.file, lineNumber: index, body: expected.comment })
    })
  })
})

describe('persistCommentsForReviewTask', () => {
  test('returns empty array when the task has no output', () => {
    expect(persistCommentsForReviewTask(ctx, { id: reviewTaskId, reviewOutput: null })).toEqual([])
  })

  test('parses the review output into comments', () => {
    const finding = { title: 'Null check', severity: 'warning', file: 'app/models/user.rb', lines: '12-14', comment: 'May be nil', suggested_fix: null }
    const reviewOutput = `Summary\n\`\`\`json\n${JSON.stringify([finding])}\n\`\`\`\n`

    const [comment] = persistCommentsForReviewTask(ctx, { id: reviewTaskId, reviewOutput })

    expect(comment).toMatchObject({
      reviewTaskId,
      title: finding.title,
      filePath: finding.file,
      lineNumber: 12,
      severity: 'major',
      body: finding.comment,
      status: 'pending',
    })
  })
})

describe('parseLineNumber', () => {
  test.each([[null], [''], ['   ']])('returns nil for %p', (input) => {
    expect(parseLineNumber(input)).toBeNull()
  })

  test.each([
    ['10', 10],
    ['10-20', 10],
    ['100-200', 100],
    ['42', 42],
  ])('extracts the starting line from %p', (input, expected) => {
    const result = parseLineNumber(input)

    expect(result).toBe(expected)
    expect(Number.isInteger(result)).toBe(true)
  })
})

describe('mapSeverity', () => {
  const cases: Array<[string | null, Severity]> = [
    ['error', 'critical'],
    ['warning', 'major'],
    ['info', 'suggestion'],
    ['unknown', 'suggestion'],
    [null, 'suggestion'],
  ]
  test.each(cases)('maps %p to %p', (severity, expected) => {
    expect(mapSeverity(severity)).toBe(expected)
  })
})

describe('detectLanguageFromFile', () => {
  test.each([
    ['app/models/user.rb', 'ruby'],
    ['src/App.TSX', 'typescript'],
    ['script.sh', 'bash'],
    ['README', ''],
    ['N/A', ''],
    [null, ''],
  ])('detects %p as %p', (file, expected) => {
    expect(detectLanguageFromFile(file)).toBe(expected)
  })
})

describe('buildCommentBody', () => {
  test('includes comment', () => {
    const comment = 'This is a comment'

    expect(buildCommentBody(item({ comment }))).toBe(comment)
  })

  test('appends suggested_fix when present', () => {
    const comment = 'This is a comment'
    const suggestedFix = 'const fixed = true;'

    const result = buildCommentBody(item({ comment, suggestedFix }))

    expect(result).toContain(comment)
    expect(result).toContain('**Suggested fix:**')
    expect(result).toContain('```')
    expect(result).toContain(suggestedFix)
  })

  test('handles multi-line suggested_fix', () => {
    const suggestedFix = 'line 1\nline 2\nline 3'

    expect(buildCommentBody(item({ suggestedFix }))).toContain(suggestedFix)
  })

  test('does not fence prose suggested_fix as code', () => {
    const comment = 'Normalizer misses variants.'
    const suggestedFix = "Normalize pathname before matching and add '/embed/' handling."

    const result = buildCommentBody(item({ severity: 'warning', file: 'src/utils/normalize-youtube-url.ts', lines: '47', comment, suggestedFix }))

    expect(result).toBe(`${comment}\n\n${suggestedFix}`)
    expect(result).not.toContain('**Suggested fix:**')
    expect(result).not.toContain('```')
  })

  test.each([[''], [null]])('handles comment %p', (comment) => {
    expect(buildCommentBody(item({ comment }))).toBe('')
  })

  test.each([[''], [null], ['   ']])('ignores suggested_fix %p', (suggestedFix) => {
    const comment = 'Fix this'

    const result = buildCommentBody(item({ comment, suggestedFix }))

    expect(result).toBe(comment)
  })

  test('uses the code block alone when the comment is blank', () => {
    const suggestedFix = 'user.save(validate: false)'

    expect(buildCommentBody(item({ comment: '', suggestedFix }))).toBe(`**Suggested fix:**\n\`\`\`ruby\n${suggestedFix}\n\`\`\``)
  })

  test('strips surrounding whitespace from the suggestion', () => {
    const suggestion = 'foo.bar(1)'

    expect(buildCommentBody(item({ comment: '', suggestedFix: `\n  ${suggestion}  \n` }))).toContain(`\n${suggestion}\n`)
  })
})

describe('createCommentFromItem', () => {
  test('creates the comment with correct attributes', () => {
    const comment = 'Fix this'
    const suggestedFix = 'const fixCode = true;'
    const title = 'Use a constant'

    const result = createCommentFromItem(ctx.db, reviewTaskId, item({ title, comment, suggestedFix }))

    expect(result).toMatchObject({ title, filePath: 'test.rb', lineNumber: 10, severity: 'critical', status: 'pending' })
    expect(result.body).toBe(`${comment}\n\n**Suggested fix:**\n\`\`\`ruby\n${suggestedFix}\n\`\`\``)
  })

  test('keeps prose suggested_fix as plain markdown text', () => {
    const comment = 'Hash timestamp is dropped.'
    const suggestedFix = 'Preserve fragment when rebuilding URLs.'

    const result = createCommentFromItem(
      ctx.db,
      reviewTaskId,
      item({ severity: 'warning', file: 'src/utils/normalize-youtube-url.ts', lines: '56', comment, suggestedFix }),
    )

    expect(result.body).toBe(`${comment}\n\n${suggestedFix}`)
    expect(result.body).not.toContain('```')
    expect(result.body).not.toContain('**Suggested fix:**')
  })
})
