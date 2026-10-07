import { describe, expect, test } from 'bun:test'
import { LineRange, LineRangeParser } from '../../src/services/line-range-parser'

describe('LineRangeParser', () => {
  test('parses single line number', () => {
    const line = 10

    const result = LineRangeParser.parse(String(line))

    expect(result?.valid()).toBe(true)
    expect(result?.startLine).toBe(line)
    expect(result?.endLine).toBe(line)
    expect(result?.singleLine).toBe(true)
  })

  test('parses single line with whitespace', () => {
    const line = 15

    const result = LineRangeParser.parse(`  ${line}  `)

    expect(result?.valid()).toBe(true)
    expect(result?.startLine).toBe(line)
    expect(result?.singleLine).toBe(true)
  })

  test('parses line range', () => {
    const [start, end] = [10, 20]

    const result = LineRangeParser.parse(`${start}-${end}`)

    expect(result?.valid()).toBe(true)
    expect(result?.startLine).toBe(start)
    expect(result?.endLine).toBe(end)
    expect(result?.singleLine).toBe(false)
  })

  test('normalizes reversed line range', () => {
    const [start, end] = [10, 20]

    const result = LineRangeParser.parse(`${end}-${start}`)

    expect(result?.valid()).toBe(true)
    expect(result?.startLine).toBe(start)
    expect(result?.endLine).toBe(end)
    expect(result?.singleLine).toBe(false)
  })

  test('parses GitHub URL fragment single line format', () => {
    const line = 15

    const result = LineRangeParser.parse(`#L${line}`)

    expect(result?.valid()).toBe(true)
    expect(result?.startLine).toBe(line)
    expect(result?.endLine).toBe(line)
    expect(result?.singleLine).toBe(true)
  })

  test('parses GitHub URL fragment range format', () => {
    const [start, end] = [10, 25]

    const result = LineRangeParser.parse(`#L${start}-L${end}`)

    expect(result?.valid()).toBe(true)
    expect(result?.startLine).toBe(start)
    expect(result?.endLine).toBe(end)
    expect(result?.singleLine).toBe(false)
  })

  test('parses L prefix without hash', () => {
    const [start, end] = [5, 15]

    const result = LineRangeParser.parse(`L${start}-L${end}`)

    expect(result?.valid()).toBe(true)
    expect(result?.startLine).toBe(start)
    expect(result?.endLine).toBe(end)
  })

  test('parses lowercase L prefix', () => {
    const [start, end] = [10, 20]

    const result = LineRangeParser.parse(`#l${start}-l${end}`)

    expect(result?.valid()).toBe(true)
    expect(result?.startLine).toBe(start)
    expect(result?.endLine).toBe(end)
  })

  test.each([
    ['nil', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
    ['non-numeric input', 'abc'],
    ['prefixed text', 'line10'],
    ['trailing text', '10abc'],
    ['zero', '0'],
    ['negative numbers', '-5'],
    ['open-ended range', '10-'],
    ['missing range start', '-20'],
    ['non-numeric range end', '10-abc'],
  ])('returns nil for %s', (_label, input) => {
    expect(LineRangeParser.parse(input)).toBeNull()
  })

  test('accepts numeric input', () => {
    const line = 7

    expect(LineRangeParser.parse(line)?.startLine).toBe(line)
  })

  test('generates correct GitHub payload for single line', () => {
    const line = 10

    const payload = LineRangeParser.parse(String(line))?.toGithubPayload()

    expect(payload).toEqual({ line, side: 'RIGHT' })
    expect(payload?.start_line).toBeUndefined()
  })

  test('generates correct GitHub payload for line range', () => {
    const [start, end] = [10, 20]

    const payload = LineRangeParser.parse(`${start}-${end}`)?.toGithubPayload()

    expect(payload?.line).toBe(end)
    expect(payload?.start_line).toBe(start)
    expect(payload?.side).toBe('RIGHT')
  })

  test('invalid ranges produce no payload and an empty string', () => {
    const reversed = new LineRange(20, 10, false)

    expect(reversed.valid()).toBe(false)
    expect(reversed.toGithubPayload()).toEqual({})
    expect(reversed.toString()).toBe('')
  })

  test('to_s returns single line number', () => {
    const input = '10'

    expect(LineRangeParser.parse(input)?.toString()).toBe(input)
  })

  test('to_s returns line range', () => {
    const input = '10-20'

    expect(LineRangeParser.parse(input)?.toString()).toBe(input)
  })

  test('valid? returns true for valid single line and range', () => {
    expect(LineRangeParser.parse('10')?.valid()).toBe(true)
    expect(LineRangeParser.parse('10-20')?.valid()).toBe(true)
  })

  test('class method and instance method parse the same way', () => {
    const [start, end] = [10, 20]
    const input = `${start}-${end}`

    const fromClass = LineRangeParser.parse(input)
    const fromInstance = new LineRangeParser().parse(input)

    expect(fromClass?.startLine).toBe(start)
    expect(fromClass?.endLine).toBe(end)
    expect(fromInstance?.startLine).toBe(start)
    expect(fromInstance?.endLine).toBe(end)
  })
})
