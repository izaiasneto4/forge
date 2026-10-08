#!/usr/bin/env bun
// Builds an installable desktop app for one platform and arch:
//   bun desktop/scripts/dist.ts --mac --arch arm64
//   bun desktop/scripts/dist.ts --linux --arch x64 --skip-frontend --skip-shell
// Steps: sync the version, build the web app, bundle the shell, compile the Bun
// server, run electron-builder (never publishing), then check the result.
// --skip-* reuse outputs a CI bundle job already produced.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { channelForVersion, resolveBuildConfig, serverResourceFolder, type BuildArch, type BuildPlatform } from '../electron-builder.config'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = join(desktopRoot, '..')

const BUN_TARGETS: Readonly<Record<string, string>> = Object.freeze({
  'mac-arm64': 'bun-darwin-arm64',
  'mac-x64': 'bun-darwin-x64',
  'linux-arm64': 'bun-linux-arm64',
  'linux-x64': 'bun-linux-x64',
  'win-x64': 'bun-windows-x64',
})

export function parseDistArgs(args: string[]) {
  const platforms: BuildPlatform[] = []
  if (args.includes('--mac')) platforms.push('mac')
  if (args.includes('--linux')) platforms.push('linux')
  if (args.includes('--win')) platforms.push('win')
  const [platform] = platforms
  if (platforms.length !== 1 || !platform) throw new Error('Pass exactly one of --mac, --linux or --win')

  const archFlag = args[args.indexOf('--arch') + 1]
  const arch: BuildArch = args.includes('--arch') ? parseArch(archFlag) : process.arch === 'arm64' ? 'arm64' : 'x64'
  const bunTarget = BUN_TARGETS[`${platform}-${arch}`]
  if (!bunTarget) throw new Error(`No server target for ${platform} ${arch}`)

  return {
    platform,
    arch,
    bunTarget,
    skipFrontend: args.includes('--skip-frontend'),
    skipShell: args.includes('--skip-shell'),
    skipServer: args.includes('--skip-server'),
  }
}

function parseArch(value: string | undefined): BuildArch {
  if (value === 'arm64' || value === 'x64') return value
  throw new Error(`Unsupported --arch ${value ?? '(missing)'}`)
}

async function run(command: string[], cwd = repositoryRoot, env: Record<string, string | undefined> = process.env) {
  console.log(`\n$ ${command.join(' ')}`)
  const child = Bun.spawn(command, { cwd, env, stdout: 'inherit', stderr: 'inherit' })
  if ((await child.exited) !== 0) throw new Error(`Failed: ${command.join(' ')}`)
}

function macSigningAvailable(env: Record<string, string | undefined>) {
  return Boolean(env.CSC_LINK && env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER)
}

async function main() {
  const options = parseDistArgs(process.argv.slice(2))
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const bun = process.execPath

  await run([bun, 'scripts/sync-version.ts'])
  if (!options.skipFrontend) await run([npm, '--prefix', 'frontend', 'run', 'build'])
  if (!options.skipShell) await run([bun, 'desktop/scripts/build.ts'])
  if (!options.skipServer) await run([bun, 'scripts/build-server.ts', '--target', options.bunTarget])

  for (const required of [join(repositoryRoot, 'public', 'frontend', 'index.html'), join(desktopRoot, 'dist-electron', 'main.cjs'), join(desktopRoot, serverResourceFolder(options.platform, options.arch))]) {
    if (!existsSync(required)) throw new Error(`Missing ${required}`)
  }

  const macSigning = options.platform === 'mac' && macSigningAvailable(process.env)
  const desktopPackage: unknown = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
  const version = typeof desktopPackage === 'object' && desktopPackage !== null && 'version' in desktopPackage && typeof desktopPackage.version === 'string' ? desktopPackage.version : ''
  const config = resolveBuildConfig({ platform: options.platform, arch: options.arch, macSigning, channel: channelForVersion(version) })
  const configPath = join(desktopRoot, 'release', 'builder-config.json')
  mkdirSync(join(desktopRoot, 'release'), { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2))

  const env = { ...process.env }
  // Signing is opt-in: without a certificate electron-builder must not go looking for one.
  if (!macSigning) env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  const builder = join(desktopRoot, 'node_modules', 'electron-builder', 'cli.js')
  await run(['node', builder, '--config', configPath, `--${options.platform}`, `--${options.arch}`, '--publish', 'never'], desktopRoot, env)

  if (options.platform === 'mac') await run([bun, 'desktop/scripts/verify-mac.ts', '--arch', options.arch, ...(macSigning ? ['--signed'] : [])])
}

if (import.meta.main) await main()
