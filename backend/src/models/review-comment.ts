import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { reviewComments } from '../db/schema'
import { RecordNotFoundError } from '../lib/errors'
import { literals } from '../lib/literals'
import { Validator } from './record'

export type ReviewCommentRecord = typeof reviewComments.$inferSelect
export type ReviewCommentValues = Omit<typeof reviewComments.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>

export const SEVERITIES = literals('critical', 'major', 'minor', 'suggestion', 'nitpick')
export const COMMENT_STATUSES = literals('pending', 'addressed', 'dismissed')
export const ACTIONABLE_SEVERITIES = ['critical', 'major', 'minor']

export type Severity = (typeof SEVERITIES)[number]

export function isSeverity(value: string): value is Severity {
  return SEVERITIES.some((severity) => severity === value)
}

export function isActionable(comment: { severity: string }) {
  return ACTIONABLE_SEVERITIES.includes(comment.severity)
}

export function commentLocation(comment: { filePath: string; lineNumber: number | null }) {
  return comment.lineNumber === null ? comment.filePath : `${comment.filePath}:${comment.lineNumber}`
}

// `by_severity` scope: critical first, nitpick last.
const severityOrder = sql`CASE ${reviewComments.severity} WHEN 'critical' THEN 1 WHEN 'major' THEN 2 WHEN 'minor' THEN 3 WHEN 'suggestion' THEN 4 WHEN 'nitpick' THEN 5 END`

export function commentsBySeverity(db: Db, reviewTaskId: number) {
  return db.select().from(reviewComments).where(eq(reviewComments.reviewTaskId, reviewTaskId)).orderBy(severityOrder).all()
}

export function pendingComments(db: Db, reviewTaskId: number) {
  return db
    .select()
    .from(reviewComments)
    .where(and(eq(reviewComments.reviewTaskId, reviewTaskId), eq(reviewComments.status, 'pending')))
    .all()
}

export function commentsWithIds(db: Db, reviewTaskId: number, ids: number[]) {
  if (ids.length === 0) return []
  return db
    .select()
    .from(reviewComments)
    .where(and(eq(reviewComments.reviewTaskId, reviewTaskId), inArray(reviewComments.id, ids)))
    .all()
}

export function findReviewComment(db: Db, id: number) {
  const record = db.select().from(reviewComments).where(eq(reviewComments.id, id)).get()
  if (!record) throw new RecordNotFoundError('ReviewComment', id)
  return record
}

function validate(values: { filePath: string; body: string; severity?: string; status?: string }) {
  const validator = new Validator()
  validator.presence('File path', values.filePath)
  validator.presence('Body', values.body)
  validator.inclusion('Severity', values.severity ?? 'suggestion', SEVERITIES)
  validator.inclusion('Status', values.status ?? 'pending', COMMENT_STATUSES)
  validator.assertValid()
}

export function createReviewComment(db: Db, values: ReviewCommentValues) {
  validate(values)
  const now = new Date()
  return db.insert(reviewComments).values({ ...values, createdAt: now, updatedAt: now }).returning().get()
}

export function updateReviewComment(db: Db, comment: ReviewCommentRecord, changes: Partial<ReviewCommentValues>) {
  validate({ ...comment, ...changes })
  const updated = db
    .update(reviewComments)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(reviewComments.id, comment.id))
    .returning()
    .get()
  if (!updated) throw new RecordNotFoundError('ReviewComment', comment.id)
  return updated
}

// Toggle cycle used by the UI: pending -> addressed -> dismissed -> pending.
export function nextCommentStatus(status: string) {
  if (status === 'pending') return 'addressed'
  if (status === 'addressed') return 'dismissed'
  return 'pending'
}

// `update_all(status: "addressed")`: no updated_at bump, no validation.
export function markCommentsAddressed(db: Db, ids: number[]) {
  if (ids.length === 0) return
  db.update(reviewComments).set({ status: 'addressed' }).where(inArray(reviewComments.id, ids)).run()
}
