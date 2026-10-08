import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RotatingLog, rotatedPath, shouldRotate } from '../src/log'

describe('shouldRotate', () => {
  test('rotates only a non-empty file that would pass the limit', () => {
    const maxBytes = 100

    expect(shouldRotate(0, 500, maxBytes)).toBe(false)
    expect(shouldRotate(60, 40, maxBytes)).toBe(false)
    expect(shouldRotate(60, 41, maxBytes)).toBe(true)
  })
})

describe('RotatingLog', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ordem-log-'))
  })

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }))

  test('keeps the newest files and drops the oldest past the limit', () => {
    const path = join(tempDir, 'logs', 'server.log')
    const keep = 2
    const log = new RotatingLog(path, { maxBytes: 10, keep })
    const [first, second, third, fourth] = ['first-----', 'second----', 'third-----', 'fourth----']

    for (const chunk of [first, second, third, fourth]) log.write(chunk)

    expect(readFileSync(path, 'utf8')).toBe(fourth)
    expect(readFileSync(rotatedPath(path, 1), 'utf8')).toBe(third)
    expect(readFileSync(rotatedPath(path, keep), 'utf8')).toBe(second)
    expect(existsSync(rotatedPath(path, keep + 1))).toBe(false)
  })
})
