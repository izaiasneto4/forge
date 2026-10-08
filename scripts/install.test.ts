import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Runs install.sh against a local release server. Failure cases run on every
// platform; the real install runs on whichever of macOS or Linux this is.

const installScript = join(import.meta.dir, '..', 'install.sh')
const version = '9.9.9'
const isMac = process.platform === 'darwin'
const releaseFile = isMac ? `Ordem-${version}-${process.arch === 'arm64' ? 'arm64' : 'x64'}.zip` : `Ordem-${version}-${process.arch === 'arm64' ? 'arm64' : 'x86_64'}.AppImage`

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

// What the server answers for SHA256SUMS in each case; null is a 404.
let checksums: string | null = null
let artifact = new Uint8Array()

const release = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname === `/v${version}/SHA256SUMS`) return checksums === null ? new Response('missing', { status: 404 }) : new Response(checksums)
    if (pathname === `/v${version}/${releaseFile}`) return new Response(artifact)
    return new Response('not found', { status: 404 })
  },
})

describe('install.sh', () => {
  let workDir: string
  let installDir: string
  let existingInstall: string
  const existingContents = 'previous install'

  beforeAll(() => {
    artifact = isMac ? macArtifact() : new TextEncoder().encode('#!/bin/sh\necho appimage\n')
  })

  afterAll(() => release.stop(true))

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ordem-install-test-'))
    installDir = join(workDir, 'Applications')
    existingInstall = isMac ? join(installDir, 'Ordem.app', 'previous.txt') : join(installDir, 'Ordem.AppImage')
    mkdirSync(join(existingInstall, '..'), { recursive: true })
    writeFileSync(existingInstall, existingContents)
  })

  afterEach(() => rmSync(workDir, { recursive: true, force: true }))

  function macArtifact() {
    const staging = mkdtempSync(join(tmpdir(), 'ordem-install-artifact-'))
    const plist = join(staging, 'Ordem.app', 'Contents', 'Info.plist')
    mkdirSync(join(plist, '..'), { recursive: true })
    writeFileSync(plist, '<plist version="1.0"><dict/></plist>')
    const zip = join(staging, 'Ordem.zip')
    Bun.spawnSync(['ditto', '-c', '-k', '--keepParent', join(staging, 'Ordem.app'), zip])
    const bytes = new Uint8Array(readFileSync(zip))
    rmSync(staging, { recursive: true, force: true })
    return bytes
  }

  async function runInstaller() {
    const env = {
      PATH: process.env.PATH,
      HOME: workDir,
      XDG_DATA_HOME: join(workDir, 'share'),
      ORDEM_VERSION: version,
      ORDEM_DOWNLOAD_URL: `http://127.0.0.1:${release.port}`,
      ORDEM_ICON_URL: `http://127.0.0.1:${release.port}/icon.png`,
      ORDEM_INSTALL_DIR: installDir,
    }
    const child = Bun.spawn(['sh', installScript], { env, stdout: 'pipe', stderr: 'pipe' })
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
    return { code, stderr }
  }

  test.each([
    ['a wrong checksum', () => `${'0'.repeat(64)}  ${releaseFile}\n`, 'checksum mismatch'],
    ['a missing SHA256SUMS', () => null, 'has no SHA256SUMS'],
    ['a SHA256SUMS without the file', () => `${sha256(artifact)}  Ordem-${version}-other.zip\n`, 'does not list'],
  ])('refuses %s and keeps the existing install', async (_label, sums, message) => {
    checksums = sums()

    const result = await runInstaller()

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain(message)
    expect(readFileSync(existingInstall, 'utf8')).toBe(existingContents)
    expect(readdirSync(installDir).filter((entry) => entry.startsWith('.Ordem.installing'))).toEqual([])
  })

  test('lets overlapping installs each finish with a complete app', async () => {
    checksums = `${sha256(artifact)}  ${releaseFile}\n`

    const results = await Promise.all([runInstaller(), runInstaller(), runInstaller()])

    expect(results.map((result) => result.code)).toEqual([0, 0, 0])
    if (isMac) {
      expect(existsSync(join(installDir, 'Ordem.app', 'Contents', 'Info.plist'))).toBe(true)
      expect(existsSync(join(installDir, 'Ordem.app', 'Ordem.app'))).toBe(false)
    } else {
      expect(new Uint8Array(readFileSync(existingInstall))).toEqual(artifact)
    }
    expect(readdirSync(installDir).filter((entry) => entry.startsWith('.Ordem.install'))).toEqual([])
  })

  test('installs a verified download over the previous one', async () => {
    checksums = `${sha256(artifact)}  ${releaseFile}\n`

    const result = await runInstaller()

    expect(result.code).toBe(0)
    if (isMac) {
      expect(existsSync(join(installDir, 'Ordem.app', 'Contents', 'Info.plist'))).toBe(true)
      expect(existsSync(existingInstall)).toBe(false)
    } else {
      expect(new Uint8Array(readFileSync(existingInstall))).toEqual(artifact)
      expect(existsSync(join(workDir, 'share', 'applications', 'ordem.desktop'))).toBe(true)
    }
    expect(readdirSync(installDir).filter((entry) => entry.startsWith('.Ordem.installing'))).toEqual([])
  })

  test('an install interrupted while waiting leaves the other run\'s lock alone', async () => {
    const lock = join(installDir, '.Ordem.install.lock')
    mkdirSync(lock)
    checksums = `${sha256(artifact)}  ${releaseFile}\n`
    const env = { PATH: process.env.PATH, HOME: workDir, XDG_DATA_HOME: join(workDir, 'share'), ORDEM_VERSION: version, ORDEM_DOWNLOAD_URL: `http://127.0.0.1:${release.port}`, ORDEM_ICON_URL: `http://127.0.0.1:${release.port}/icon.png`, ORDEM_INSTALL_DIR: installDir }
    const waiting = Bun.spawn(['sh', installScript], { env, stdout: 'pipe', stderr: 'pipe' })
    // It has staged its copy and is now polling for the lock.
    for (let tries = 0; tries < 250 && !readdirSync(installDir).some((entry) => entry.startsWith('.Ordem.installing')); tries += 1) await Bun.sleep(20)
    await Bun.sleep(300)
    waiting.kill('SIGINT')
    const code = await waiting.exited

    expect(code).not.toBe(0)
    expect(existsSync(lock)).toBe(true)
    expect(readFileSync(existingInstall, 'utf8')).toBe(existingContents)
    expect(readdirSync(installDir).filter((entry) => entry.startsWith('.Ordem.installing'))).toEqual([])
  })
})
