import { describe, expect, test } from 'bun:test'
import { isJsonObject } from '../../src/cli/formatter'
import { closedPortUrl, readJson, runBin, spawnBin, withStubServer } from './support'

// Port of the original Ruby CLI integration tests: runs bin/ordem.ts as a
// process against an in-process server that answers with the API's shapes.

const repo = 'acme/api'

function apiError(code: string, message: string) {
  return { ok: false, error: { code, message } }
}

function fieldOf(payload: unknown, key: string) {
  return isJsonObject(payload) ? payload[key] : undefined
}

function syncState(secondsUntilSyncAllowed: number) {
  return {
    status: 'succeeded',
    running: false,
    last_synced_at: '2026-10-07T12:00:00Z',
    last_error: null,
    fetched_count: 3,
    seconds_until_sync_allowed: secondsUntilSyncAllowed,
    sync_needed: secondsUntilSyncAllowed === 0,
  }
}

describe('ordem cli e2e', () => {
  test('sync forced and skipped and failure and connection error', async () => {
    const secondsRemaining = 15

    await withStubServer(
      async (request) => {
        const forced = fieldOf(await readJson(request), 'force') === true
        return forced
          ? [200, { ok: true, skipped: false, already_running: false, sync: syncState(0), last_synced_at: null }]
          : [200, { ok: true, skipped: true, sync: syncState(secondsRemaining), seconds_remaining: secondsRemaining, last_synced_at: null }]
      },
      async (baseUrl) => {
        const forced = await runBin(['sync', '--force'], baseUrl)
        expect(forced.code).toBe(0)
        expect(forced.stdout).toBe('Synced successfully\n')

        const skipped = await runBin(['sync'], baseUrl)
        expect(skipped.code).toBe(0)
        expect(skipped.stdout).toBe(`Sync skipped (${secondsRemaining}s remaining)\n`)
      },
    )

    const failure = apiError('sync_failed', 'boom')
    await withStubServer(
      () => [422, failure],
      async (baseUrl) => {
        const { code, stderr } = await runBin(['sync', '--force'], baseUrl)
        expect(code).toBe(1)
        expect(stderr).toBe(`API error (${failure.error.code}): ${failure.error.message}\n`)
      },
    )

    const closed = await closedPortUrl()
    const { code, stderr } = await runBin(['sync', '--force'], closed.url)
    expect(code).toBe(2)
    expect(stderr).toStartWith(`Connection error: Failed to open TCP connection to 127.0.0.1:${closed.port}`)
  })

  test('review edge cases', async () => {
    const pending = { url: `https://github.com/${repo}/pull/1`, taskId: 1, state: 'pending_review' }
    const queued = { url: `https://github.com/${repo}/pull/2`, taskId: 2, state: 'queued', position: 2 }
    const running = `https://github.com/${repo}/pull/3`
    const mismatch = 'https://github.com/mismatch/repo/pull/1'

    await withStubServer(
      async (request) => {
        const prUrl = fieldOf(await readJson(request), 'pr_url')
        if (prUrl === pending.url) {
          return [201, { ok: true, task_id: pending.taskId, state: pending.state, queue_position: null, pull_request_id: 10 }]
        }
        if (prUrl === queued.url) {
          return [201, { ok: true, task_id: queued.taskId, state: queued.state, queue_position: queued.position, pull_request_id: 11 }]
        }
        if (prUrl === running) return [409, apiError('conflict', 'Review already in progress for PR #3')]
        if (prUrl === mismatch) return [422, apiError('invalid_input', `PR repo mismatch/repo does not match current repo ${repo}`)]
        return [422, apiError('invalid_input', 'pr_url must be a valid GitHub pull request URL')]
      },
      async (baseUrl) => {
        const started = await runBin(['review', pending.url], baseUrl)
        expect(started.code).toBe(0)
        expect(started.stdout).toBe(`Review task #${pending.taskId} ${pending.state}\n`)

        const waiting = await runBin(['review', queued.url], baseUrl)
        expect(waiting.code).toBe(0)
        expect(waiting.stdout).toBe(`Review task #${queued.taskId} ${queued.state} (queue position ${queued.position})\n`)

        const conflict = await runBin(['review', running], baseUrl)
        expect(conflict.code).toBe(1)
        expect(conflict.stderr).toStartWith('API error (conflict)')

        expect((await runBin(['review', mismatch], baseUrl)).code).toBe(1)

        const invalid = await runBin(['review', 'bad-url'], baseUrl)
        expect(invalid.code).toBe(1)
        expect(invalid.stderr).toStartWith('API error (invalid_input)')
      },
    )
  })

  test('status and list edge cases', async () => {
    const counts = { pending_review: 0, in_review: 1, queued: 1, failed_review: 1 }
    const item = { id: 5, number: 1, title: 'Fix', url: `https://github.com/${repo}/pull/1`, repo, review_status: 'pending_review', updated_at_github: null }

    await withStubServer(
      (request) => {
        const url = new URL(request.url)
        if (url.pathname === '/api/v1/status') {
          return [200, { ok: true, repo, counts, running_task_id: null, last_synced_at: null, sync_status: syncState(0) }]
        }

        const status = url.searchParams.get('status')
        const limit = url.searchParams.get('limit')
        if (status === 'invalid' || limit === '0' || limit === '9999') return [422, apiError('invalid_input', 'bad')]
        return [200, { ok: true, items: [item] }]
      },
      async (baseUrl) => {
        const status = await runBin(['status'], baseUrl)
        expect(status.code).toBe(0)
        expect(status.stdout).toBe(
          `repo=${repo} pending=${counts.pending_review} in_review=${counts.in_review} queued=${counts.queued} failed=${counts.failed_review}\n`,
        )

        const list = await runBin(['list'], baseUrl)
        expect(list.code).toBe(0)
        expect(list.stdout).toBe(`#${item.number} [${item.review_status}] ${item.repo} ${item.title}\n`)

        const json = await runBin(['list', '--json'], baseUrl)
        expect(fieldOf(JSON.parse(json.stdout), 'items')).toEqual([item])

        expect((await runBin(['list', '--status', 'invalid'], baseUrl)).code).toBe(1)
        expect((await runBin(['list', '--limit', '0'], baseUrl)).code).toBe(1)
        expect((await runBin(['list', '--limit', '9999'], baseUrl)).code).toBe(1)
      },
    )
  })

  test('logs edge cases', async () => {
    const logs = [
      { id: 1, created_at: '2026-10-07T12:00:00Z', log_type: 'output', message: 'first' },
      { id: 2, created_at: '2026-10-07T12:00:01Z', log_type: 'error', message: 'second' },
    ]
    const task = { id: 1, state: 'in_review', pull_request_number: 7 }

    await withStubServer(
      (request) => {
        const url = new URL(request.url)
        if (url.pathname === '/api/v1/review_tasks/1/logs') {
          if (url.searchParams.get('tail') === '0') return [422, apiError('invalid_input', 'tail must be between 1 and 1000')]
          return [200, { ok: true, task, logs }]
        }
        if (url.pathname === '/api/v1/review_tasks/2/logs') return [200, { ok: true, task: { ...task, id: 2 }, logs: [] }]
        return [404, apiError('not_found', 'Resource not found')]
      },
      async (baseUrl) => {
        const tailed = await runBin(['logs', '1', '--tail', '2'], baseUrl)
        expect(tailed.code).toBe(0)
        expect(tailed.stdout).toBe(logs.map((entry) => `[${entry.id}] ${entry.log_type}: ${entry.message}\n`).join(''))

        const empty = await runBin(['logs', '2'], baseUrl)
        expect(empty.code).toBe(0)
        expect(empty.stdout).toBe('No logs\n')

        const missing = await runBin(['logs', '999'], baseUrl)
        expect(missing.code).toBe(1)
        expect(missing.stderr).toBe('API error (not_found): Resource not found\n')

        expect((await runBin(['logs', '1', '--tail', '0'], baseUrl)).code).toBe(1)
      },
    )
  })

  test('repo switch edge cases', async () => {
    const repoPath = '/tmp/acme-api'

    await withStubServer(
      async (request) => {
        const slug = fieldOf(await readJson(request), 'repo')
        if (slug === repo) return [201, { ok: true, message: 'Switched to acme-api and synced', repo_path: repoPath, repo: slug, synced: true }]
        if (slug === 'missing/api') return [404, apiError('not_found', 'No local repository matched missing/api')]
        if (slug === 'multi/api') return [409, apiError('conflict', 'Multiple local repositories matched multi/api')]
        if (slug === 'invalid') return [422, apiError('invalid_input', 'repo must be in org/repo format')]
        return [422, apiError('sync_failed', 'Switched repo but sync failed: boom')]
      },
      async (baseUrl) => {
        const switched = await runBin(['repo', 'switch', repo], baseUrl)
        expect(switched.code).toBe(0)
        expect(switched.stdout).toBe(`Switched to ${repo} (${repoPath})\n`)

        for (const slug of ['missing/api', 'multi/api', 'invalid', 'syncfail/api']) {
          expect((await runBin(['repo', 'switch', slug], baseUrl)).code).toBe(1)
        }
      },
    )
  })

  test('Ctrl-C ends logs --follow with exit 0', async () => {
    const first = { id: 1, log_type: 'output', message: 'first' }

    await withStubServer(
      (request) => {
        const following = new URL(request.url).searchParams.has('after_id')
        return [200, { ok: true, logs: following ? [] : [first] }]
      },
      async (baseUrl) => {
        const child = spawnBin(['logs', '1', '--follow'], baseUrl)
        const reader = child.stdout.getReader()
        const { value } = await reader.read()
        reader.releaseLock()

        child.kill('SIGINT')

        expect(await child.exited).toBe(0)
        expect(new TextDecoder().decode(value)).toBe(`[${first.id}] ${first.log_type}: ${first.message}\n`)
      },
    )
  })

  test('Ctrl-C during any other command kills the process with SIGINT, like an unrescued Interrupt', async () => {
    let answer = () => {}
    const unanswered = new Promise<void>((resolve) => (answer = resolve))
    let requestArrived = () => {}
    const arrived = new Promise<void>((resolve) => (requestArrived = resolve))

    await withStubServer(
      async () => {
        requestArrived()
        await unanswered
        return [200, {}]
      },
      async (baseUrl) => {
        const child = spawnBin(['status'], baseUrl)
        await arrived

        child.kill('SIGINT')
        await child.exited
        answer()

        expect(child.signalCode).toBe('SIGINT')
      },
    )
  })
})
