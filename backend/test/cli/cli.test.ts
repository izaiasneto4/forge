import { describe, expect, test } from 'bun:test'
import { Interrupt, interruptibleSleep } from '../../src/cli/cli'
import { ApiError, ConnectionError, DEFAULT_API_URL, type OrdemApi } from '../../src/cli/client'
import { runCli, ScriptedClient, TEST_API_URL } from './support'

const prUrl = 'https://github.com/acme/api/pull/1'
const repo = 'acme/api'
const taskId = '1'
const followIntervalSeconds = 2

const usage = 'Usage: ordem <command>'
const reviewUsage = 'Usage: ordem review <pr-url>'
const logsUsage = 'Usage: ordem logs <task-id>'
const repoUsage = 'Usage: ordem repo switch <org/repo>'

function log(id: number, message: string) {
  return { id, log_type: 'output', message }
}

function formatLog(entry: ReturnType<typeof log>) {
  return `[${entry.id}] ${entry.log_type}: ${entry.message}`
}

describe('ordem cli', () => {
  test('unknown command returns 1', async () => {
    const command = 'wat'

    const { code, stderr } = await runCli([command])

    expect(code).toBe(1)
    expect(stderr).toBe(`Unknown command: ${command}\n`)
  })

  test('usage when command missing', async () => {
    const { code, stderr } = await runCli([])

    expect(code).toBe(1)
    expect(stderr).toBe(`${usage}\n`)
  })

  test('builds the client from ORDEM_API_URL, defaulting to the local server', async () => {
    const baseUrls: string[] = []
    const createClient = (baseUrl: string): OrdemApi => {
      baseUrls.push(baseUrl)
      return new ScriptedClient()
    }

    await runCli([], { createClient })
    await runCli([], { createClient, env: {} })

    expect(baseUrls).toEqual([TEST_API_URL, DEFAULT_API_URL])
  })

  describe('sync', () => {
    test('sync command success', async () => {
      const client = new ScriptedClient([{ result: { skipped: false } }])

      const { code, stdout } = await runCli(['sync', '--force'], { client })

      expect(code).toBe(0)
      expect(client.calls).toEqual([{ method: 'sync', params: { force: true } }])
      expect(stdout).toBe('Synced successfully\n')
    })

    test('sync --json', async () => {
      const payload = { ok: true, skipped: true, seconds_remaining: 2 }
      const client = new ScriptedClient([{ result: payload }])

      const { code, stdout } = await runCli(['sync', '--json'], { client })

      expect(code).toBe(0)
      expect(client.calls).toEqual([{ method: 'sync', params: { force: false } }])
      expect(stdout).toBe(`${JSON.stringify(payload, null, 2)}\n`)
    })
  })

  describe('review', () => {
    test('review requires pr url', async () => {
      const { code, stderr, client } = await runCli(['review'])

      expect(code).toBe(1)
      expect(stderr).toBe(`${reviewUsage}\n`)
      expect(client.calls).toEqual([])
    })

    test('review with options', async () => {
      const cliClient = 'codex'
      const reviewType = 'swarm'
      const answer = { task_id: 1, state: 'queued', queue_position: 2 }
      const client = new ScriptedClient([{ result: answer }])

      const { code, stdout } = await runCli(['review', prUrl, '--client', cliClient, '--type', reviewType], { client })

      expect(code).toBe(0)
      expect(client.calls).toEqual([{ method: 'review', params: { prUrl, cliClient, reviewType } }])
      expect(stdout).toBe(
        `Review task #${answer.task_id} ${answer.state} (queue position ${answer.queue_position})\n`,
      )
    })

    test('review --json', async () => {
      const payload = { ok: true }
      const client = new ScriptedClient([{ result: payload }])

      const { code, stdout } = await runCli(['review', prUrl, '--json'], { client })

      expect(code).toBe(0)
      expect(client.calls).toEqual([
        { method: 'review', params: { prUrl, cliClient: undefined, reviewType: undefined } },
      ])
      expect(JSON.parse(stdout)).toEqual(payload)
    })
  })

  describe('status', () => {
    test('status command', async () => {
      const counts = { pending_review: 1, in_review: 0, queued: 0, failed_review: 0 }
      const client = new ScriptedClient([{ result: { repo, counts } }])

      const { code, stdout } = await runCli(['status'], { client })

      expect(code).toBe(0)
      expect(client.calls).toEqual([{ method: 'status', params: undefined }])
      expect(stdout).toBe(
        `repo=${repo} pending=${counts.pending_review} in_review=${counts.in_review} queued=${counts.queued} failed=${counts.failed_review}\n`,
      )
    })

    test('status --json', async () => {
      const payload = { ok: true }
      const client = new ScriptedClient([{ result: payload }])

      const { code, stdout } = await runCli(['status', '--json'], { client })

      expect(code).toBe(0)
      expect(JSON.parse(stdout)).toEqual(payload)
    })

    test('a payload Ruby could not format raises instead of printing', async () => {
      const client = new ScriptedClient([{ result: null }])

      await expect(runCli(['status'], { client })).rejects.toThrow(TypeError)
    })
  })

  describe('list', () => {
    test('list command', async () => {
      const status = 'pending_review'
      const limit = 10
      const client = new ScriptedClient([{ result: { items: [] } }])

      const { code, stdout } = await runCli(['list', '--status', status, '--limit', String(limit)], { client })

      expect(code).toBe(0)
      expect(client.calls).toEqual([{ method: 'list', params: { status, limit: BigInt(limit) } }])
      expect(stdout).toBe('No pull requests\n')
    })

    test('list --json', async () => {
      const payload = { items: [] }
      const client = new ScriptedClient([{ result: payload }])

      const { code, stdout } = await runCli(['list', '--json'], { client })

      expect(code).toBe(0)
      expect(client.calls).toEqual([{ method: 'list', params: { status: undefined, limit: undefined } }])
      expect(JSON.parse(stdout)).toEqual(payload)
    })

    test('option parse error returns 1', async () => {
      const badLimit = 'oops'

      const { code, stderr, client } = await runCli(['list', '--limit', badLimit])

      expect(code).toBe(1)
      expect(stderr).toBe(`invalid argument: --limit ${badLimit}\n`)
      expect(client.calls).toEqual([])
    })
  })

  describe('logs', () => {
    test('logs command requires id', async () => {
      const { code, stderr } = await runCli(['logs'])

      expect(code).toBe(1)
      expect(stderr).toBe(`${logsUsage}\n`)
    })

    test('logs without follow returns 0', async () => {
      const client = new ScriptedClient([{ result: { logs: [] } }])

      const { code, stdout } = await runCli(['logs', taskId], { client })

      expect(code).toBe(0)
      expect(client.calls).toEqual([{ method: 'logs', params: { taskId, tail: undefined } }])
      expect(stdout).toBe('No logs\n')
    })

    test('logs follow with interrupt', async () => {
      const tail = 5
      const first = log(1, 'first')
      const client = new ScriptedClient([{ result: { logs: [first] } }, { error: new Interrupt() }])

      const { code, stdout } = await runCli(['logs', taskId, '--tail', String(tail), '--follow'], { client })

      expect(code).toBe(0)
      expect(client.calls).toEqual([
        { method: 'logs', params: { taskId, tail: BigInt(tail) } },
        { method: 'logs', params: { taskId, tail: BigInt(tail), afterId: first.id } },
      ])
      expect(stdout).toBe(`${formatLog(first)}\n`)
    })

    test('logs follow prints new logs and sleeps', async () => {
      const tail = 5
      const first = log(1, 'first')
      const second = log(2, 'second')
      const sleeps: number[] = []
      const client = new ScriptedClient([
        { result: { logs: [first] } },
        { result: { logs: [second] } },
        { error: new Interrupt() },
      ])

      const { code, stdout } = await runCli(['logs', taskId, '--tail', String(tail), '--follow'], {
        client,
        sleep: (seconds) => {
          sleeps.push(seconds)
        },
      })

      expect(code).toBe(0)
      expect(client.calls.map((call) => call.params)).toEqual([
        { taskId, tail: BigInt(tail) },
        { taskId, tail: BigInt(tail), afterId: first.id },
        { taskId, tail: BigInt(tail), afterId: second.id },
      ])
      expect(stdout).toBe(`${formatLog(first)}\n${formatLog(second)}\n`)
      expect(sleeps).toEqual([followIntervalSeconds])
    })

    test('logs follow with no new logs still sleeps', async () => {
      const first = log(1, 'first')
      const sleeps: number[] = []
      const client = new ScriptedClient([{ result: { logs: [first] } }, { result: { logs: [] } }])

      const { code } = await runCli(['logs', taskId, '--tail', '5', '--follow'], {
        client,
        sleep: (seconds) => {
          sleeps.push(seconds)
          throw new Interrupt()
        },
      })

      expect(code).toBe(0)
      expect(sleeps).toEqual([followIntervalSeconds])
      expect(client.unansweredCount).toBe(0)
    })

    test('logs follow resumes after the highest id seen and ignores nil entries', async () => {
      const newest = log(7, 'newest')
      const older = log(3, 'older')
      const client = new ScriptedClient([
        { result: { logs: [newest, older] } },
        { result: { logs: [null] } },
        { error: new Interrupt() },
      ])

      const { stdout } = await runCli(['logs', taskId, '--follow'], { client })

      expect(client.calls.map((call) => call.params)).toEqual([
        { taskId, tail: undefined },
        { taskId, tail: undefined, afterId: newest.id },
        { taskId, tail: undefined, afterId: newest.id },
      ])
      expect(stdout).toBe(`${formatLog(newest)}\n${formatLog(older)}\n`)
    })

    test('logs follow with no logs yet polls without after_id', async () => {
      const client = new ScriptedClient([{ result: { logs: [] } }, { error: new Interrupt() }])

      await runCli(['logs', taskId, '--follow'], { client })

      expect(client.calls[1]?.params).toEqual({ taskId, tail: undefined, afterId: null })
    })

    test('logs follow incompatible with json', async () => {
      const payload = { logs: [] }
      const client = new ScriptedClient([{ result: payload }])

      const { code, stdout, stderr } = await runCli(['logs', taskId, '--follow', '--json'], { client })

      expect(code).toBe(1)
      expect(client.calls).toEqual([{ method: 'logs', params: { taskId, tail: undefined } }])
      expect(JSON.parse(stdout)).toEqual(payload)
      expect(stderr).toBe('--follow and --json are incompatible\n')
    })
  })

  describe('repo', () => {
    test('repo command usage errors', async () => {
      const { code, stderr } = await runCli(['repo'])

      expect(code).toBe(1)
      expect(stderr).toBe(`${repoUsage}\n`)
    })

    test('repo with another subcommand is a usage error', async () => {
      const { code, stderr } = await runCli(['repo', 'list'])

      expect(code).toBe(1)
      expect(stderr).toBe(`${repoUsage}\n`)
    })

    test('repo switch success', async () => {
      const repoPath = '/tmp/r'
      const client = new ScriptedClient([{ result: { repo, repo_path: repoPath } }])

      const { code, stdout } = await runCli(['repo', 'switch', repo], { client })

      expect(code).toBe(0)
      expect(client.calls).toEqual([{ method: 'switchRepo', params: { repo } }])
      expect(stdout).toBe(`Switched to ${repo} (${repoPath})\n`)
    })

    test('repo switch usage missing repo', async () => {
      const { code, stderr } = await runCli(['repo', 'switch'])

      expect(code).toBe(1)
      expect(stderr).toBe(`${repoUsage}\n`)
    })

    test('repo switch --json', async () => {
      const payload = { ok: true }
      const client = new ScriptedClient([{ result: payload }])

      const { code, stdout } = await runCli(['repo', 'switch', repo, '--json'], { client })

      expect(code).toBe(0)
      expect(client.calls).toEqual([{ method: 'switchRepo', params: { repo } }])
      expect(JSON.parse(stdout)).toEqual(payload)
    })
  })

  describe('errors', () => {
    test('api error maps to exit 1', async () => {
      const errorCode = 'invalid'
      const message = 'bad'
      const client = new ScriptedClient([{ error: new ApiError(message, errorCode, 422) }])

      const { code, stderr } = await runCli(['status'], { client })

      expect(code).toBe(1)
      expect(stderr).toBe(`API error (${errorCode}): ${message}\n`)
    })

    test('connection error maps to exit 2', async () => {
      const message = 'down'
      const client = new ScriptedClient([{ error: new ConnectionError(message) }])

      const { code, stderr } = await runCli(['status'], { client })

      expect(code).toBe(2)
      expect(stderr).toBe(`Connection error: ${message}\n`)
    })

    test('an interrupt outside logs is not swallowed', async () => {
      const client = new ScriptedClient([{ error: new Interrupt() }])

      await expect(runCli(['status'], { client })).rejects.toThrow(Interrupt)
    })
  })
})

// The parts of Ruby's OptionParser the commands rely on, checked against its real output.
describe('option parsing', () => {
  async function syncOptions(...options: string[]) {
    const client = new ScriptedClient([{ result: { skipped: false } }])
    const run = await runCli(['sync', ...options], { client })
    return { ...run, params: client.calls[0]?.params, json: run.stdout.startsWith('{') }
  }

  async function listParams(...options: string[]) {
    const client = new ScriptedClient([{ result: { items: [] } }])
    const run = await runCli(['list', ...options], { client })
    return { ...run, params: client.calls[0]?.params }
  }

  test('options and operands can be mixed in any order', async () => {
    const tail = 5
    const client = new ScriptedClient([{ result: { logs: [] } }])

    await runCli(['logs', '--tail', String(tail), taskId, '--json'], { client })

    expect(client.calls[0]?.params).toEqual({ taskId, tail: BigInt(tail) })
  })

  test('POSIXLY_CORRECT stops at the first operand', async () => {
    const client = new ScriptedClient([{ result: { logs: [] } }])

    const { code } = await runCli(['logs', taskId, '--follow'], {
      client,
      env: { ORDEM_API_URL: TEST_API_URL, POSIXLY_CORRECT: '1' },
    })

    expect(code).toBe(0)
    expect(client.calls).toHaveLength(1)
  })

  test('-- ends option parsing', async () => {
    const operand = '--json'
    const client = new ScriptedClient([{ result: { task_id: 1, state: 'queued' } }])

    await runCli(['review', '--', operand], { client })

    expect(client.calls[0]?.params).toEqual({ prUrl: operand, cliClient: undefined, reviewType: undefined })
  })

  test.each([['--fo'], ['--FORCE'], ['-f']])('completes %p to --force', async (option) => {
    expect((await syncOptions(option)).params).toEqual({ force: true })
  })

  test('bundles short flags', async () => {
    const run = await syncOptions('-fj')

    expect(run.params).toEqual({ force: true })
    expect(run.json).toBe(true)
  })

  test('a required argument takes the next word, even one that looks like an option', async () => {
    const cliClient = '--json'
    const client = new ScriptedClient([{ result: { task_id: 1, state: 'queued' } }])

    await runCli(['review', prUrl, '--client', cliClient], { client })

    expect(client.calls[0]?.params).toEqual({ prUrl, cliClient, reviewType: undefined })
  })

  test.each([
    ['-ccodex', 'codex'],
    ['-c=codex', '=codex'],
    ['--client=codex', 'codex'],
    ['--client=', ''],
  ])('reads the argument of %p as %p', async (option, cliClient) => {
    const client = new ScriptedClient([{ result: { task_id: 1, state: 'queued' } }])

    await runCli(['review', prUrl, option], { client })

    expect(client.calls[0]?.params).toEqual({ prUrl, cliClient, reviewType: undefined })
  })

  test.each([
    ['10', 10n],
    ['010', 8n],
    ['0x1F', 31n],
    ['0b11', 3n],
    ['1_000', 1000n],
    ['-5', -5n],
    ['+5', 5n],
    ['0', 0n],
    ['123456789012345678901234567890', 123456789012345678901234567890n],
  ])('accepts the Integer literal %p', async (literal, limit) => {
    expect((await listParams('--limit', literal)).params).toEqual({ status: undefined, limit })
  })

  test.each(['oops', '', '08', '0_8', '5.0', ' 5', '0o7'])('rejects the Integer literal %p', async (literal) => {
    const { code, stderr } = await listParams('--limit', literal)

    expect(code).toBe(1)
    expect(stderr).toBe(`invalid argument: --limit ${literal}\n`)
  })

  test.each([
    [['--limit=08'], 'invalid argument: --limit=08'],
    [['-lx'], 'invalid argument: -lx'],
    [['-l', 'x'], 'invalid argument: -l x'],
    [['-l=5'], 'invalid argument: -l=5'],
    [['--limit'], 'missing argument: --limit'],
    [['-l'], 'missing argument: -l'],
    [['--json=1'], 'needless argument: --json=1'],
    [['-j=1'], 'needless argument: -j=1'],
    [['--=x'], 'needless argument: --=x'],
    [['--wat'], 'invalid option: --wat'],
    [['--wat=1'], 'invalid option: --wat=1'],
    [['-x'], 'invalid option: -x'],
    [['-J'], 'invalid option: -J'],
    [['-jx'], 'invalid option: -x'],
  ])('reports %p as %p', async (options, message) => {
    const { code, stderr } = await listParams(...options)

    expect(code).toBe(1)
    expect(stderr).toBe(`${message}\n`)
  })

  test.each([
    ['list', '--limt', 'limit'],
    ['list', '--li_mit', 'limit'],
    ['list', '--sttus', 'status'],
    ['logs', '--folow', 'follow'],
    ['logs', '--tial', 'tail'],
    ['sync', '--jsn', 'json'],
    ['sync', '--frce', 'force'],
    ['sync', '--verson', 'version'],
  ])('%s suggests a correction for %p', async (command, typo, intended) => {
    const { code, stderr } = await runCli([command, typo])

    expect(code).toBe(1)
    expect(stderr).toBe(`invalid option: ${typo}\nDid you mean?  ${intended}\n`)
  })

  test.each([['--help'], ['-h'], ['--he']])('%p prints the option summary and exits 0', async (option) => {
    const { code, stdout, client } = await runCli(['list', option, '--wat'])

    expect(code).toBe(0)
    expect(stdout).toBe(
      ['Usage: ordem [options]', '        --status STATUS', '        --limit LIMIT', '        --json', ''].join('\n'),
    )
    expect(client.calls).toEqual([])
  })

  test('errors before --help win', async () => {
    const { code, stderr } = await runCli(['sync', '--wat', '--help'])

    expect(code).toBe(1)
    expect(stderr).toBe('invalid option: --wat\n')
  })

  test.each([
    [['--version'], 'ordem: version unknown'],
    [['-v'], 'ordem: version unknown'],
    [['--version=pkg'], 'ordem: no version found in package pkg'],
  ])('%p aborts like OptionParser without a version', async (options, message) => {
    const { code, stderr, stdout } = await runCli(['status', ...options])

    expect(code).toBe(1)
    expect(stderr).toBe(`${message}\n`)
    expect(stdout).toBe('')
  })
})

describe('interruptibleSleep', () => {
  test('waits for the given seconds', async () => {
    const seconds = 0.01
    const startedAt = performance.now()

    await interruptibleSleep()(seconds)

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(seconds * 1000 - 1)
  })

  test('turns an abort into an Interrupt', async () => {
    const interrupt = new AbortController()
    const sleeping = interruptibleSleep(interrupt.signal)(60)

    interrupt.abort()

    await expect(sleeping).rejects.toThrow(Interrupt)
  })

  test('raises right away once interrupted', async () => {
    const interrupt = new AbortController()
    interrupt.abort()

    await expect(interruptibleSleep(interrupt.signal)(60)).rejects.toThrow(Interrupt)
  })
})
