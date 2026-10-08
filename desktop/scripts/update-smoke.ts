#!/usr/bin/env bun
// End-to-end update test for a Linux AppImage, with no release published:
// serves a newer build's release folder (latest-linux.yml and the AppImage)
// over local HTTP, starts a copy of the older AppImage with --update-smoke and
// ORDEM_UPDATE_FEED_URL, then checks the copy now reports the newer version.
//   xvfb-run -a bun desktop/scripts/update-smoke.ts --old Ordem-0.0.1.AppImage --feed desktop/release --expect 0.0.2
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize, sep } from 'node:path'

function flag(name: string) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const oldAppImage = flag('--old')
const feedDir = normalize(flag('--feed'))
const expectedVersion = flag('--expect')

const feed = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const path = normalize(join(feedDir, decodeURIComponent(new URL(request.url).pathname)))
    if (!path.startsWith(`${feedDir}${sep}`) || !existsSync(path)) return new Response('not found', { status: 404 })
    console.log(`[feed] ${request.method} ${new URL(request.url).pathname}`)
    return new Response(Bun.file(path))
  },
})

const workDir = mkdtempSync(join(tmpdir(), 'ordem-update-smoke-'))
const installed = join(workDir, 'Ordem.AppImage')
copyFileSync(oldAppImage, installed)
chmodSync(installed, 0o755)

const env: Record<string, string | undefined> = {
  ...process.env,
  ORDEM_HOME: join(workDir, 'home'),
  ORDEM_UPDATE_FEED_URL: `http://127.0.0.1:${feed.port}/`,
  // Runs without FUSE; the runtime still sets APPIMAGE, which the updater replaces.
  APPIMAGE_EXTRACT_AND_RUN: '1',
}
delete env.ELECTRON_RUN_AS_NODE

async function run(args: string[]) {
  const child = Bun.spawn([installed, ...args], { env, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { code, stdout: stdout.trim(), stderr: stderr.trim() }
}

try {
  const before = await run(['--version', '--no-sandbox'])
  console.log(`installed version: ${before.stdout}`)

  const update = await run(['--update-smoke', '--no-sandbox'])
  console.log(update.stdout)
  if (update.code !== 0) {
    console.error(update.stderr)
    throw new Error(`--update-smoke exited ${update.code}`)
  }

  const after = await run(['--version', '--no-sandbox'])
  console.log(`version after update: ${after.stdout}`)
  if (after.stdout !== expectedVersion) throw new Error(`Expected ${expectedVersion}, got ${after.stdout || after.stderr}`)
  console.log('Update smoke test passed')
} finally {
  feed.stop(true)
  rmSync(workDir, { recursive: true, force: true })
}
