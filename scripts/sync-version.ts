#!/usr/bin/env bun
// Copies the root package.json version into desktop/package.json, which is what
// electron-builder stamps on the app, its artifacts and the update feed.
//   bun scripts/sync-version.ts            use the root version
//   bun scripts/sync-version.ts 1.2.0      set both (e.g. from a v1.2.0 tag)
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

function readVersion(path: string) {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || typeof parsed.version !== 'string') throw new Error(`${path} has no version`)
  return parsed.version
}

// Rewrites only the version line, keeping the file's formatting.
export function withVersion(packageJson: string, version: string) {
  return packageJson.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`)
}

export function versionFromTag(tag: string) {
  return tag.replace(/^v/, '')
}

if (import.meta.main) {
  const rootPackage = join(repositoryRoot, 'package.json')
  const desktopPackage = join(repositoryRoot, 'desktop', 'package.json')
  const requested = process.argv[2]
  const version = requested ? versionFromTag(requested) : readVersion(rootPackage)
  if (!SEMVER.test(version)) throw new Error(`Not a semantic version: ${version}`)

  for (const path of requested ? [rootPackage, desktopPackage] : [desktopPackage]) {
    writeFileSync(path, withVersion(readFileSync(path, 'utf8'), version))
  }
  console.log(`Desktop version ${version}`)
}
