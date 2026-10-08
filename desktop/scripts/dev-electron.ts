#!/usr/bin/env bun
// Development launcher: waits for the shell bundle and Vite, starts Electron,
// and restarts it whenever dist-electron/ changes. Electron starts its own
// server from source (bun --watch backend/src/index.ts) with state in ~/.ordem/dev.
import { existsSync, watch } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(desktopRoot, 'dist-electron')
const electronBinary = join(desktopRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron')
const devServerUrl = process.env.ORDEM_DEV_SERVER_URL ?? 'http://localhost:5173'
const RESTART_DEBOUNCE_MS = 300

async function waitFor(check: () => Promise<boolean> | boolean, label: string) {
  for (let logged = false; !(await check()); ) {
    if (!logged) console.log(`[dev-electron] waiting for ${label}`)
    logged = true
    await Bun.sleep(200)
  }
}

async function viteAnswers() {
  try {
    return (await fetch(`${devServerUrl}/frontend/`)).ok
  } catch {
    return false
  }
}

await waitFor(() => existsSync(join(distDir, 'main.cjs')) && existsSync(join(distDir, 'preload.cjs')), 'dist-electron')
await waitFor(viteAnswers, `Vite at ${devServerUrl}`)

const env: Record<string, string | undefined> = { ...process.env, ORDEM_DEV_SERVER_URL: devServerUrl }
delete env.ELECTRON_RUN_AS_NODE

let electron: ReturnType<typeof Bun.spawn> | null = null
let restarting = false

function launch() {
  console.log('[dev-electron] starting Electron')
  const child = Bun.spawn([electronBinary, '.'], { cwd: desktopRoot, env, stdio: ['inherit', 'inherit', 'inherit'] })
  electron = child
  void child.exited.then((code) => {
    if (electron !== child) return
    electron = null
    // Quitting the app window ends the dev session.
    if (!restarting) process.exit(code)
  })
}

async function restart() {
  restarting = true
  const running = electron
  electron = null
  if (running) {
    running.kill('SIGTERM')
    await running.exited
  }
  restarting = false
  launch()
}

let pending: ReturnType<typeof setTimeout> | null = null
watch(distDir, () => {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => void restart(), RESTART_DEBOUNCE_MS)
})

function shutdown() {
  electron?.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

launch()
