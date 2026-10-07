import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { openDatabase } from '../../src/db/client'
import { migrateDatabase } from '../../src/db/migrate'
import { findPullRequest } from '../../src/models/pull-request'
import { fixOrphanedStates } from '../../src/scripts/pull-requests-fix-orphaned-states'
import { FIX_COMMAND, validateConsistency } from '../../src/scripts/pull-requests-validate-consistency'
import type { OutputWriter } from '../../src/scripts/script-context'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest, insertReviewTask } from '../support/factories'
import { createTempFolder } from '../support/git'

class RecordingOutput implements OutputWriter {
  readonly lines: string[] = []

  puts(line: string) {
    this.lines.push(line)
  }
}

let ctx: TestContext
let output: RecordingOutput

beforeEach(() => {
  ctx = createTestContext()
  output = new RecordingOutput()
})

describe('pull_requests:fix_orphaned_states', () => {
  test('reports when there is nothing to fix', () => {
    insertPullRequest(ctx.db, { reviewStatus: 'pending_review' })

    expect(fixOrphanedStates(ctx.db, output)).toBe(0)
    expect(output.lines).toEqual(['Checking for orphaned review states...', '✓ No orphaned states found - all pull requests are consistent'])
  })

  test('resets orphaned pull requests and reports the count', () => {
    const orphanedStatuses = ['reviewed_by_me', 'in_review']
    const orphaned = orphanedStatuses.map((reviewStatus) => insertPullRequest(ctx.db, { reviewStatus }))
    const withTask = insertPullRequest(ctx.db, { reviewStatus: 'reviewed_by_me' })
    insertReviewTask(ctx.db, { pullRequestId: withTask.id, state: 'reviewed' })

    const fixedCount = fixOrphanedStates(ctx.db, output)

    expect(fixedCount).toBe(orphaned.length)
    expect(output.lines.at(-1)).toBe(`✓ Fixed ${orphaned.length} orphaned pull request(s)`)
    expect(orphaned.map((pullRequest) => findPullRequest(ctx.db, pullRequest.id).reviewStatus)).toEqual(orphaned.map(() => 'pending_review'))
    expect(findPullRequest(ctx.db, withTask.id).reviewStatus).toBe(withTask.reviewStatus)
  })
})

describe('pull_requests:validate_consistency', () => {
  test('reports a consistent database', () => {
    const reviewed = insertPullRequest(ctx.db, { reviewStatus: 'reviewed_by_me' })
    insertReviewTask(ctx.db, { pullRequestId: reviewed.id, state: 'reviewed' })

    expect(validateConsistency(ctx.db, output)).toEqual([])
    expect(output.lines).toEqual(['Validating review state consistency...', '✓ All pull requests have consistent review states'])
  })

  test('lists pull requests whose review status fails validation', () => {
    const orphan = insertPullRequest(ctx.db, { reviewStatus: 'waiting_implementation', title: 'Orphan' })
    const unknown = insertPullRequest(ctx.db, { reviewStatus: 'bogus', title: 'Unknown' })
    insertPullRequest(ctx.db, { reviewStatus: 'in_review', archived: true })

    const inconsistent = validateConsistency(ctx.db, output)

    expect(inconsistent.map((entry) => entry.id)).toEqual([orphan.id, unknown.id])
    expect(output.lines).toEqual([
      'Validating review state consistency...',
      `⚠ Found ${inconsistent.length} inconsistent pull request(s):`,
      `  - PR #${orphan.number} (${orphan.title}): ${orphan.reviewStatus} - cannot be '${orphan.reviewStatus}' without a review task`,
      `  - PR #${unknown.number} (${unknown.title}): ${unknown.reviewStatus} - is not included in the list`,
      `\nRun '${FIX_COMMAND}' to fix these issues`,
    ])
  })
})

describe('script entry points', () => {
  let folder: ReturnType<typeof createTempFolder>
  let databasePath: string

  beforeEach(() => {
    folder = createTempFolder()
    databasePath = join(folder.path, 'ordem.sqlite3')
    const db = openDatabase(databasePath)
    migrateDatabase(db)
    insertPullRequest(db, { reviewStatus: 'reviewed_by_me' })
    db.$client.close()
  })

  afterEach(() => {
    folder.remove()
  })

  async function runScriptFile(name: string) {
    const scriptPath = new URL(`../../src/scripts/${name}`, import.meta.url).pathname
    const child = Bun.spawn(['bun', scriptPath], { env: { ...process.env, DATABASE_PATH: databasePath }, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
    return { stdout, exitCode }
  }

  test('validate-consistency then fix-orphaned-states run against DATABASE_PATH', async () => {
    const validation = await runScriptFile('pull-requests-validate-consistency.ts')
    const fix = await runScriptFile('pull-requests-fix-orphaned-states.ts')

    expect(validation.exitCode).toBe(0)
    expect(validation.stdout).toContain('⚠ Found 1 inconsistent pull request(s):')
    expect(fix.exitCode).toBe(0)
    expect(fix.stdout).toContain('✓ Fixed 1 orphaned pull request(s)')
  })
})
