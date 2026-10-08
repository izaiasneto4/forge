#!/usr/bin/env bun
// Compiles the backend into one executable per desktop target:
//   bun scripts/build-server.ts                         host target
//   bun scripts/build-server.ts --target bun-linux-x64  one target
//   bun scripts/build-server.ts --all                   every target
// Output: desktop/prod-resources/server/<platform>-<arch>/ordem-server[.exe],
// where <platform>-<arch> uses electron-builder's names so its extraResources
// entry can point at `server/${platform}-${arch}` verbatim.
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const serverEntry = join(repositoryRoot, 'backend', 'src', 'index.ts')
export const SERVER_OUTPUT_DIR = join(repositoryRoot, 'desktop', 'prod-resources', 'server')

export interface ServerTarget {
  bunTarget: string
  folder: string
  binary: string
}

// The only owner of the Bun target to folder mapping (spec 2.7).
export const SERVER_TARGETS: readonly ServerTarget[] = Object.freeze([
  { bunTarget: 'bun-darwin-arm64', folder: 'darwin-arm64', binary: 'ordem-server' },
  { bunTarget: 'bun-darwin-x64', folder: 'darwin-x64', binary: 'ordem-server' },
  { bunTarget: 'bun-linux-x64', folder: 'linux-x64', binary: 'ordem-server' },
  { bunTarget: 'bun-linux-arm64', folder: 'linux-arm64', binary: 'ordem-server' },
  { bunTarget: 'bun-windows-x64', folder: 'win32-x64', binary: 'ordem-server.exe' },
])

export function hostTarget(platform: string = process.platform, arch: string = process.arch) {
  return SERVER_TARGETS.find((target) => target.folder === `${platform}-${arch}`)
}

export function targetsFromArgs(args: string[]) {
  if (args.includes('--all')) return [...SERVER_TARGETS]
  const flagIndex = args.indexOf('--target')
  if (flagIndex === -1) {
    const host = hostTarget()
    if (!host) throw new Error(`No server target for ${process.platform}-${process.arch}`)
    return [host]
  }
  const requested = args[flagIndex + 1]
  const target = SERVER_TARGETS.find((candidate) => candidate.bunTarget === requested)
  if (!target) throw new Error(`Unknown target ${requested ?? '(missing)'}; expected one of ${SERVER_TARGETS.map((candidate) => candidate.bunTarget).join(', ')}`)
  return [target]
}

// Bun only accepts --windows-hide-console when compiling on Windows; a cross
// build still runs hidden because the shell spawns it with windowsHide.
export function compileArgs(target: ServerTarget, outfile: string, hostPlatform: string = process.platform) {
  const args = ['build', '--compile', `--target=${target.bunTarget}`, serverEntry, '--outfile', outfile]
  if (target.folder.startsWith('win32') && hostPlatform === 'win32') args.push('--windows-hide-console')
  return args
}

async function compile(target: ServerTarget) {
  const outputDir = join(SERVER_OUTPUT_DIR, target.folder)
  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })
  const outfile = join(outputDir, target.binary)

  const build = Bun.spawn([process.execPath, ...compileArgs(target, outfile)], { cwd: repositoryRoot, stdout: 'inherit', stderr: 'inherit' })
  if ((await build.exited) !== 0) throw new Error(`bun build failed for ${target.bunTarget}`)
  console.log(`Built ${outfile}`)
}

if (import.meta.main) {
  for (const target of targetsFromArgs(process.argv.slice(2))) await compile(target)
}
