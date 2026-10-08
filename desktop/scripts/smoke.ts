#!/usr/bin/env bun
// Launches the packaged app with --smoke, which exits 0 once the server answered,
// React rendered and the renderer reached the API with its token (30 s budget).
//   bun desktop/scripts/smoke.ts [--arch arm64|x64] [path/to/executable]
// On Linux CI, run it under xvfb-run.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unpackedApp } from './release-paths'

const args = process.argv.slice(2)
const archIndex = args.indexOf('--arch')
const arch = archIndex === -1 ? (process.arch === 'arm64' ? 'arm64' : 'x64') : args[archIndex + 1] === 'arm64' ? 'arm64' : 'x64'
const explicit = args.find((arg, index) => !arg.startsWith('--') && index !== archIndex + 1)
const executable = explicit ?? unpackedApp(process.platform, arch).executable

const home = mkdtempSync(join(tmpdir(), 'ordem-app-smoke-'))
const env: Record<string, string | undefined> = { ...process.env, ORDEM_HOME: home }
delete env.ELECTRON_RUN_AS_NODE

// The unpacked Linux build's chrome-sandbox is not setuid root (an installed
// .deb's is), so Chromium refuses to start sandboxed there.
const sandboxArgs = process.platform === 'linux' ? ['--no-sandbox'] : []

async function launch(extra: string[]) {
  const child = Bun.spawn([executable, ...extra, ...sandboxArgs], { env, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { code, stdout, stderr }
}

try {
  const version = await launch(['--version'])
  console.log(`version: ${version.stdout.trim()}`)
  if (version.code !== 0) throw new Error(`--version exited ${version.code}: ${version.stderr}`)

  const smoke = await launch(['--smoke'])
  console.log(smoke.stdout.trim())
  if (smoke.code !== 0) {
    console.error(smoke.stderr)
    throw new Error(`--smoke exited ${smoke.code}`)
  }
  console.log('Desktop smoke test passed')
} finally {
  rmSync(home, { recursive: true, force: true })
}
