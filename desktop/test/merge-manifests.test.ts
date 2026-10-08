import { describe, expect, test } from 'bun:test'
import { mergeManifests, parseManifest } from '../scripts/merge-manifests'

function manifest(arch: string, date: string) {
  return [
    'version: 1.2.0',
    'files:',
    `  - url: Ordem-1.2.0-${arch}.zip`,
    `    sha512: zip-${arch}`,
    '    size: 100',
    `  - url: Ordem-1.2.0-${arch}.dmg`,
    `    sha512: dmg-${arch}`,
    '    size: 200',
    `path: Ordem-1.2.0-${arch}.zip`,
    `sha512: zip-${arch}`,
    `releaseDate: '${date}'`,
    '',
  ].join('\n')
}

describe('mergeManifests', () => {
  test('lists both architectures under one feed', () => {
    const intel = manifest('x64', '2026-10-08T10:00:00.000Z')
    const appleSilicon = manifest('arm64', '2026-10-08T10:05:00.000Z')

    const merged = parseManifest(mergeManifests([intel, appleSilicon]))

    expect(merged.files.filter((line) => line.startsWith('  - url: '))).toEqual([
      '  - url: Ordem-1.2.0-x64.zip',
      '  - url: Ordem-1.2.0-x64.dmg',
      '  - url: Ordem-1.2.0-arm64.zip',
      '  - url: Ordem-1.2.0-arm64.dmg',
    ])
    expect(merged.head).toEqual(['version: 1.2.0'])
    expect(merged.tail).toEqual(parseManifest(intel).tail)
  })

  test('does not duplicate entries already listed', () => {
    const intel = manifest('x64', '2026-10-08T10:00:00.000Z')

    const merged = parseManifest(mergeManifests([intel, intel]))

    expect(merged.files).toEqual(parseManifest(intel).files)
  })
})
