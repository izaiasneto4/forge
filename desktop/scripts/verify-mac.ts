#!/usr/bin/env bun
// Checks a built Ordem.app: the Bun server sits in Resources/ with a valid
// signature, hardened runtime when Developer ID signed, and the JIT
// entitlements, then boots it from inside the bundle. Without allow-jit a
// hardened Bun binary dies at startup, so this is the check that matters.
//   bun desktop/scripts/verify-mac.ts --arch arm64 [--signed]
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { unpackedApp } from './release-paths'

const args = process.argv.slice(2)
const arch = args[args.indexOf('--arch') + 1] === 'x64' ? 'x64' : 'arm64'
const signed = args.includes('--signed')
const app = unpackedApp('darwin', arch)
const server = join(app.resources, 'server', 'ordem-server')

async function output(command: string[]) {
  const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { code, text: `${stdout}${stderr}` }
}

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(`verify-mac: ${message}`)
  console.log(`ok  ${message}`)
}

check(existsSync(server), `server binary at ${server}`)
check(existsSync(join(app.resources, 'drizzle', 'meta', '_journal.json')), 'migrations in Resources/drizzle')
check(existsSync(join(app.resources, 'public', 'frontend', 'index.html')), 'web build in Resources/public')

const appSignature = await output(['codesign', '--verify', '--deep', '--strict', app.bundle])
check(appSignature.code === 0, `app signature verifies${appSignature.code === 0 ? '' : `: ${appSignature.text}`}`)

const serverDetails = await output(['codesign', '-d', '--verbose=2', '--entitlements', '-', '--xml', server])
check(serverDetails.code === 0, 'server binary is signed')
check(serverDetails.text.includes('com.apple.security.cs.allow-jit'), 'server binary carries the allow-jit entitlement')
if (signed) {
  check(/flags=0x[0-9a-f]*\(runtime\)|runtime/.test(serverDetails.text), 'server binary uses the hardened runtime')
  check(serverDetails.text.includes('Authority=Developer ID Application'), 'server binary signed with Developer ID')
}

const boot = Bun.spawn([process.execPath, 'scripts/smoke-server.ts', server], { cwd: join(import.meta.dir, '..', '..'), stdout: 'inherit', stderr: 'inherit' })
check((await boot.exited) === 0, 'server boots from inside the bundle')
