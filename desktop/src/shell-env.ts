import { execFile } from 'node:child_process'
import { delimiter } from 'node:path'

// GUI launches on macOS and Linux start with a short PATH (no Homebrew, no
// ~/.local/bin), so `gh` and `claude` go missing. Ask the user's login shell
// (and launchctl, and the PowerShell profile on Windows) what the terminal sees.

export const SHELL_PROBE_TIMEOUT_MS = 3000
const START_MARKER = '__ORDEM_ENV_START__'
const END_MARKER = '__ORDEM_ENV_END__'
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

// Values that describe the probe's own shell session, not the user's setup.
const VOLATILE_KEYS = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TERM_SESSION_ID', 'COLUMNS', 'LINES', 'PS1'])

export type Env = Record<string, string | undefined>

export interface ProbeResult {
  stdout: string
}

export type Probe = (command: string, args: string[], timeoutMs: number) => Promise<ProbeResult>

export const execProbe: Probe = (command, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) reject(error)
      else resolve({ stdout })
    })
  })

export function loginShellArgs() {
  return ['-ilc', `printf '%s\\n' '${START_MARKER}'; /usr/bin/env; printf '%s\\n' '${END_MARKER}'`]
}

// rc files may print banners; only the lines between the markers are the environment.
export function parseEnvOutput(output: string): Record<string, string> {
  const start = output.indexOf(START_MARKER)
  const end = output.indexOf(END_MARKER, start + 1)
  const body = start === -1 ? output : output.slice(start + START_MARKER.length, end === -1 ? undefined : end)
  const parsed: Record<string, string> = {}
  for (const line of body.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator)
    if (!ENV_KEY.test(key) || VOLATILE_KEYS.has(key)) continue
    parsed[key] = line.slice(separator + 1)
  }
  return parsed
}

// Earlier lists win; later ones only add entries that are missing.
export function mergePathLists(lists: Array<string | undefined>, separator = delimiter) {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const list of lists) {
    for (const entry of list?.split(separator) ?? []) {
      const trimmed = entry.trim()
      if (trimmed === '' || seen.has(trimmed)) continue
      seen.add(trimmed)
      merged.push(trimmed)
    }
  }
  return merged.join(separator)
}

// Windows env keys are case-insensitive and usually spelled `Path`.
export function pathKey(env: Env, platform: NodeJS.Platform) {
  if (platform !== 'win32') return 'PATH'
  return Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'Path'
}

async function probeUnix(env: Env, platform: NodeJS.Platform, probe: Probe, log: (message: string) => void): Promise<Env> {
  const shell = env.SHELL?.trim() || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
  let recovered: Record<string, string> = {}
  try {
    recovered = parseEnvOutput((await probe(shell, loginShellArgs(), SHELL_PROBE_TIMEOUT_MS)).stdout)
  } catch (error) {
    log(`[shell-env] ${shell} probe failed, keeping the launch environment: ${String(error)}`)
  }

  let launchdPath: string | undefined
  if (platform === 'darwin') {
    try {
      launchdPath = (await probe('/bin/launchctl', ['getenv', 'PATH'], SHELL_PROBE_TIMEOUT_MS)).stdout.trim() || undefined
    } catch {
      launchdPath = undefined
    }
  }

  return { ...recovered, PATH: mergePathLists([recovered.PATH, launchdPath, env.PATH], ':') }
}

async function probeWindows(env: Env, probe: Probe, log: (message: string) => void): Promise<Env> {
  const key = pathKey(env, 'win32')
  try {
    // Without -NoProfile, so PATH edits in $PROFILE (scoop, volta, npm) apply.
    const { stdout } = await probe('powershell.exe', ['-NoLogo', '-NonInteractive', '-Command', '[Console]::Out.Write($env:Path)'], SHELL_PROBE_TIMEOUT_MS)
    return { [key]: mergePathLists([stdout.trim(), env[key]], ';') }
  } catch (error) {
    log(`[shell-env] PowerShell probe failed, keeping the launch environment: ${String(error)}`)
    return {}
  }
}

// What to lay over process.env for the server. Never throws: a failed probe
// falls back to the launch environment with a log line.
export async function recoverShellEnvironment(options: { env: Env; platform: NodeJS.Platform; probe?: Probe; log?: (message: string) => void }): Promise<Env> {
  const probe = options.probe ?? execProbe
  const log = options.log ?? (() => {})
  if (options.platform === 'win32') return probeWindows(options.env, probe, log)
  return probeUnix(options.env, options.platform, probe, log)
}
