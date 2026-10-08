#!/usr/bin/env bun
// Boots a compiled server from a temp directory with env vars only, the way the
// desktop shell runs it, and checks /up and /api/v1/status answer 200.
//   bun scripts/smoke-server.ts [path/to/ordem-server]
// Regression test for resources resolved from import.meta.url inside the binary.
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostTarget, SERVER_OUTPUT_DIR } from './build-server'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const READY_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 100
const SMOKE_PORT = Number(process.env.SMOKE_PORT ?? 3977)

function defaultBinary() {
  const target = hostTarget()
  if (!target) throw new Error(`No server target for ${process.platform}-${process.arch}`)
  return join(SERVER_OUTPUT_DIR, target.folder, target.binary)
}

async function waitForUp(baseUrl: string, server: { exitCode: number | null }) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Server exited with ${server.exitCode} before /up answered`)
    try {
      if ((await fetch(`${baseUrl}/up`)).ok) return
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`/up did not answer within ${READY_TIMEOUT_MS} ms`)
}

async function expectOk(url: string) {
  const response = await fetch(url)
  if (response.status !== 200) throw new Error(`${url} answered ${response.status}`)
  console.log(`${url} 200`)
}

const binary = process.argv[2] ?? defaultBinary()
if (!existsSync(binary)) throw new Error(`No server binary at ${binary}; run bun scripts/build-server.ts first`)

const workDir = mkdtempSync(join(tmpdir(), 'ordem-smoke-'))
const migrationsDir = join(workDir, 'drizzle')
const publicDir = join(workDir, 'public')
cpSync(join(repositoryRoot, 'backend', 'drizzle'), migrationsDir, { recursive: true })
cpSync(join(repositoryRoot, 'public'), publicDir, { recursive: true })

const baseUrl = `http://127.0.0.1:${SMOKE_PORT}`
const server = Bun.spawn([binary], {
  cwd: workDir,
  env: {
    PATH: process.env.PATH,
    HOME: workDir,
    NODE_ENV: 'production',
    ORDEM_MODE: 'desktop',
    ORDEM_HOME: join(workDir, 'home'),
    ORDEM_HOST: '127.0.0.1',
    ORDEM_MIGRATIONS_DIR: migrationsDir,
    ORDEM_PUBLIC_DIR: publicDir,
    ORDEM_DISABLE_JOB_WORKER: '1',
    PORT: String(SMOKE_PORT),
  },
  stdout: 'inherit',
  stderr: 'inherit',
})

try {
  await waitForUp(baseUrl, server)
  await expectOk(`${baseUrl}/up`)
  await expectOk(`${baseUrl}/api/v1/status`)
  if (!existsSync(join(workDir, 'home', 'userdata', 'ordem.sqlite3'))) throw new Error('Database was not created under ORDEM_HOME/userdata')
  console.log('Sidecar smoke test passed')
} finally {
  server.kill()
  await server.exited
  rmSync(workDir, { recursive: true, force: true })
}
