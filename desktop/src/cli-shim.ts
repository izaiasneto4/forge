import { chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DesktopLocalEnvironment } from '@shared/desktop-bridge'

// The `ordem` command for desktop users: a shell script that sources a file the
// shell keeps in the state dir while the server is up. That file holds the URL,
// the token and the CLI command itself, so the script survives the app moving
// (an AppImage mounts somewhere new on every launch). Node built-ins only.

export const CONNECTION_FILE = 'desktop-connection.env'
export const SYSTEM_BIN_DIR = '/usr/local/bin'

export interface CliCommand {
  command: string
  args: string[]
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function connectionFileContents(environment: DesktopLocalEnvironment, cli: CliCommand) {
  const command = [cli.command, ...cli.args].map(shellQuote).join(' ')
  return `ORDEM_API_URL=${shellQuote(environment.httpBaseUrl)}
ORDEM_API_TOKEN=${shellQuote(environment.token)}
ordem_cli() {
  exec ${command} "$@"
}
`
}

// Owner-only: the token lets its holder drive the API.
export function writeConnectionFile(stateDir: string, environment: DesktopLocalEnvironment, cli: CliCommand) {
  const path = join(stateDir, CONNECTION_FILE)
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(path, connectionFileContents(environment, cli), { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

export function removeConnectionFile(stateDir: string) {
  rmSync(join(stateDir, CONNECTION_FILE), { force: true })
}

export function shimScript(connectionFile: string) {
  return `#!/bin/sh
# Installed by the Ordem desktop app. Runs the ordem CLI against the server the app started.
connection=${shellQuote(connectionFile)}
if [ ! -r "$connection" ]; then
  echo "ordem: open the Ordem app first" >&2
  exit 1
fi
set -a
. "$connection"
set +a
ordem_cli "$@"
`
}

export interface InstallResult {
  shimPath: string
  // Where the command was linked onto PATH, or null when that needs the user.
  linkedAt: string | null
}

// Writes <home>/bin/ordem, then links it from /usr/local/bin when that is writable.
export function installCliShim(options: { home: string; stateDir: string; systemBinDir?: string }): InstallResult {
  const binDir = join(options.home, 'bin')
  const shimPath = join(binDir, 'ordem')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(shimPath, shimScript(join(options.stateDir, CONNECTION_FILE)), { mode: 0o755 })
  chmodSync(shimPath, 0o755)

  const systemBinDir = options.systemBinDir ?? SYSTEM_BIN_DIR
  const link = join(systemBinDir, 'ordem')
  try {
    if (existsSync(link) || isSymlink(link)) {
      if (!isSymlink(link) || readlinkSync(link) !== shimPath) return { shimPath, linkedAt: null }
      return { shimPath, linkedAt: link }
    }
    symlinkSync(shimPath, link)
    return { shimPath, linkedAt: link }
  } catch {
    return { shimPath, linkedAt: null }
  }
}

function isSymlink(path: string) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}
