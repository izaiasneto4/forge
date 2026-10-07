import type { AppContext } from '../context'
import type { Db } from '../db/client'
import { RecordInvalidError } from '../lib/errors'
import type { BroadcastMessage, Broadcaster } from '../realtime/broadcaster'

function sameValue(left: unknown, right: unknown) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  return left === right
}

// ActiveRecord dirty tracking: `update!` with values equal to the stored ones
// issues no write and leaves updated_at alone.
export function hasChanges(current: Record<string, unknown>, changes: Record<string, unknown>) {
  return Object.entries(changes).some(([key, value]) => value !== undefined && !sameValue(current[key], value))
}

export function changed(current: Record<string, unknown>, changes: Record<string, unknown>, key: string) {
  return key in changes && changes[key] !== undefined && !sameValue(current[key], changes[key])
}

// Collects validation messages in ActiveModel full_messages form.
export class Validator {
  readonly messages: string[] = []

  inclusion(label: string, value: string | null | undefined, allowed: readonly string[], options: { allowNil?: boolean } = {}) {
    if ((value === null || value === undefined) && options.allowNil) return
    if (value === null || value === undefined || !allowed.includes(value)) this.messages.push(`${label} is not included in the list`)
  }

  presence(label: string, value: unknown) {
    const blank = value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
    if (blank) this.messages.push(`${label} can't be blank`)
  }

  add(message: string) {
    this.messages.push(message)
  }

  assertValid() {
    if (this.messages.length > 0) throw new RecordInvalidError(this.messages)
  }
}

const transactionDepth = new WeakMap<Db, number>()

// ActiveRecord `transaction` plus after_commit: writes run atomically, and
// broadcasts made inside are delivered only once the outermost block commits.
export function transaction<Result>(ctx: AppContext, work: (txCtx: AppContext) => Result): Result {
  const depth = transactionDepth.get(ctx.db) ?? 0
  if (depth > 0) return work(ctx)

  const deferred: Array<[string, BroadcastMessage]> = []
  const deferredEvents: Broadcaster = {
    broadcast(stream, message) {
      deferred.push([stream, message])
    },
  }

  transactionDepth.set(ctx.db, depth + 1)
  let result: Result
  try {
    result = ctx.db.transaction(() => work({ ...ctx, events: deferredEvents }))
  } finally {
    transactionDepth.set(ctx.db, depth)
  }

  for (const [stream, message] of deferred) ctx.events.broadcast(stream, message)
  return result
}
