import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { MAX_PATH_LENGTH, validateNewPath, validatePath } from '../../src/services/path-validator'

describe('path validator', () => {
  let base: string
  let outside: string

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'ordem-base-')))
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'ordem-outside-')))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  test('rejects non-strings, empty, overlong, missing and NUL-containing paths', () => {
    const rejected: unknown[] = [null, 123, {}, [], '', 'x'.repeat(MAX_PATH_LENGTH + 1), '/this/path/does/not/exist', 'a\0b']

    expect(rejected.map((path) => validatePath(path))).toEqual(rejected.map(() => null))
  })

  test('resolves existing paths through symlinks', () => {
    const target = join(base, 'target')
    const link = join(base, 'link')
    mkdirSync(target)
    symlinkSync(target, link)

    expect(validatePath(link)).toBe(target)
  })

  test('accepts the base itself and paths inside it, but nothing outside', () => {
    const inside = join(base, 'subdir')
    const escapingLink = join(base, 'escape')
    mkdirSync(inside)
    symlinkSync(outside, escapingLink)

    expect(validatePath(base, base)).toBe(base)
    expect(validatePath(inside, base)).toBe(inside)
    expect(validatePath(outside, base)).toBeNull()
    expect(validatePath(escapingLink, base)).toBeNull()
    expect(validatePath(join(base, '..', basename(outside)), base)).toBeNull()
  })

  test('validates paths that do not exist yet by their nearest existing ancestor', () => {
    const nested = join(base, 'nested')
    mkdirSync(nested)
    const newPath = join(nested, 'child', 'file.txt')

    expect(validateNewPath(newPath)).toBe(newPath)
    expect(validateNewPath(join(base, 'subdir', 'file.txt'), base)).toBe(join(base, 'subdir', 'file.txt'))
    expect(validateNewPath(join(outside, 'child', 'file.txt'), base)).toBeNull()
    expect(validateNewPath('../tmp/file')).toBeNull()
    expect(validateNewPath(null)).toBeNull()
  })

  test('does not treat a sibling with the same prefix as inside the base', () => {
    const sibling = `${base}-other`
    mkdirSync(sibling)

    try {
      expect(validateNewPath(join(sibling, 'file.txt'), base)).toBeNull()
    } finally {
      rmSync(sibling, { recursive: true, force: true })
    }
  })
})
