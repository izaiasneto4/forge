import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONNECTION_FILE, installCliShim, removeConnectionFile, writeConnectionFile } from '../src/cli-shim'

const environment = { httpBaseUrl: 'http://127.0.0.1:51234', wsBaseUrl: 'ws://127.0.0.1:51234', token: 'd'.repeat(64) }

describe('CLI shim', () => {
  let tempDir: string
  let home: string
  let stateDir: string
  let systemBinDir: string
  const cli = { command: '/Applications/Ordem.app/Contents/Resources/server/ordem-server', args: ['cli'] }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ordem-shim-'))
    home = join(tempDir, '.ordem')
    stateDir = join(home, 'userdata')
    systemBinDir = join(tempDir, 'usr-local-bin')
    mkdirSync(systemBinDir)
  })

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }))

  test('keeps the connection in an owner-only file and removes it on stop', () => {
    const path = writeConnectionFile(stateDir, environment)

    const contents = readFileSync(path, 'utf8')
    const mode = statSync(path).mode & 0o777
    removeConnectionFile(stateDir)

    expect(contents).toContain(`ORDEM_API_URL='${environment.httpBaseUrl}'`)
    expect(contents).toContain(`ORDEM_API_TOKEN='${environment.token}'`)
    expect(mode).toBe(0o600)
    expect(() => statSync(path)).toThrow()
  })

  test('installs an executable shim and links it onto PATH', () => {
    const result = installCliShim({ home, stateDir, cli, systemBinDir })

    const script = readFileSync(result.shimPath, 'utf8')
    expect(result.linkedAt).toBe(join(systemBinDir, 'ordem'))
    expect(readlinkSync(join(systemBinDir, 'ordem'))).toBe(result.shimPath)
    expect(statSync(result.shimPath).mode & 0o111).toBeGreaterThan(0)
    expect(script).toContain(join(stateDir, CONNECTION_FILE))
    expect(script).toContain(`exec '${cli.command}' 'cli' "$@"`)
  })

  test('leaves an unrelated ordem on PATH alone', () => {
    const existing = join(systemBinDir, 'ordem')
    writeFileSync(existing, '#!/bin/sh\necho other\n')

    const result = installCliShim({ home, stateDir, cli, systemBinDir })

    expect(result.linkedAt).toBeNull()
    expect(readFileSync(existing, 'utf8')).toContain('other')
  })

  test('runs the CLI with the connection loaded', async () => {
    writeConnectionFile(stateDir, environment)
    const echo = { command: '/bin/sh', args: ['-c', 'echo "$ORDEM_API_URL $ORDEM_API_TOKEN $1"', 'sh'] }
    const { shimPath } = installCliShim({ home, stateDir, cli: echo, systemBinDir })
    const argument = 'status'

    const run = Bun.spawn([shimPath, argument], { stdout: 'pipe' })
    const output = (await new Response(run.stdout).text()).trim()

    expect(output).toBe(`${environment.httpBaseUrl} ${environment.token} ${argument}`)
  })
})
