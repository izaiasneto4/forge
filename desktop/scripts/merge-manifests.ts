#!/usr/bin/env bun
// The macOS arm64 and x64 jobs each write a latest-mac.yml listing only their
// own files. electron-updater needs one feed listing both, so merge them:
//   bun desktop/scripts/merge-manifests.ts <dir with latest-mac*.yml files> <output>
// The manifests are electron-builder's fixed format, so plain text handling is enough.
import { readFileSync, writeFileSync } from 'node:fs'

export interface Manifest {
  head: string[]
  files: string[]
  tail: string[]
}

export function parseManifest(text: string): Manifest {
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n')
  const filesStart = lines.indexOf('files:')
  if (filesStart === -1) throw new Error('Manifest has no files: list')
  let filesEnd = filesStart + 1
  while (filesEnd < lines.length && (lines[filesEnd] ?? '').startsWith(' ')) filesEnd += 1
  return { head: lines.slice(0, filesStart), files: lines.slice(filesStart + 1, filesEnd), tail: lines.slice(filesEnd) }
}

function entryUrls(files: string[]) {
  return files.filter((line) => line.startsWith('  - url: ')).map((line) => line.slice('  - url: '.length))
}

// Keeps the first manifest's version, path and date (legacy single-file fields)
// and appends every file entry the others add.
export function mergeManifests(texts: string[]) {
  const [first, ...rest] = texts.map(parseManifest)
  if (!first) throw new Error('No manifests to merge')
  const files = [...first.files]
  for (const manifest of rest) {
    const known = new Set(entryUrls(files))
    let copying = false
    for (const line of manifest.files) {
      if (line.startsWith('  - url: ')) copying = !known.has(line.slice('  - url: '.length))
      if (copying) files.push(line)
    }
  }
  return `${[...first.head, 'files:', ...files, ...first.tail].join('\n')}\n`
}

if (import.meta.main) {
  const [output, ...inputs] = process.argv.slice(2).reverse()
  if (!output || inputs.length === 0) throw new Error('Usage: merge-manifests.ts <input.yml>... <output.yml>')
  writeFileSync(output, mergeManifests(inputs.reverse().map((path) => readFileSync(path, 'utf8'))))
  console.log(`Merged ${inputs.length} manifests into ${output}`)
}
