import { describe, expect, test } from 'bun:test'
import { parseReviewOutput, type ReviewItemSeverity } from '../../src/services/review-output-parser'

function jsonBlock(json: string, before = '', after = '') {
  return `${before}\`\`\`json\n${json}\n\`\`\`\n${after}`
}

describe('parseReviewOutput', () => {
  test('extracts findings from the first json block', () => {
    const finding = { severity: 'error', file: 'test.rb', lines: '10', comment: 'Fix this' }

    const [item] = parseReviewOutput(jsonBlock(JSON.stringify([finding]), 'Some text before\n', 'Some text after\n'))

    expect(item).toMatchObject({ severity: 'error', file: finding.file, lines: finding.lines, comment: finding.comment })
  })

  test.each([null, '', 'Just some plain text without any JSON', jsonBlock('{invalid json}'), jsonBlock('{"severity": "error"}')])(
    'returns no findings for %p',
    (output) => {
      expect(parseReviewOutput(output)).toEqual([])
    },
  )

  test('skips array entries that are not objects', () => {
    const files = ['test.rb', 'other.rb']
    const json = JSON.stringify([{ file: files[0] }, 'string item', 123, null, { file: files[1] }])

    expect(parseReviewOutput(jsonBlock(json)).map((item) => item.file)).toEqual(files)
  })

  const severityCases: Array<[string, ReviewItemSeverity]> = [
    ['error', 'error'],
    ['critical', 'error'],
    ['BUG', 'error'],
    ['Warning', 'warning'],
    ['issue', 'warning'],
    ['concern', 'warning'],
    ['suggestion', 'info'],
    ['', 'info'],
  ]
  test.each(severityCases)('normalizes severity %p to %p', (severity, expected) => {
    const [item] = parseReviewOutput(jsonBlock(JSON.stringify([{ severity, file: 'a.rb' }])))

    expect(item?.severity).toBe(expected)
  })

  test('fills defaults for missing optional fields', () => {
    const comment = 'Missing some fields. Second sentence'

    const [item] = parseReviewOutput(jsonBlock(JSON.stringify([{ file: 'test.rb', comment }])))

    expect(item).toMatchObject({ severity: 'info', lines: null, suggestedFix: '', title: 'Missing some fields' })
  })

  test('maps unknown or blank files to N/A and stringifies line numbers', () => {
    const lineNumber = 42

    const [unknown, blank] = parseReviewOutput(jsonBlock(JSON.stringify([{ file: 'Unknown file', lines: lineNumber }, { file: '  ' }])))

    expect(unknown).toMatchObject({ file: 'N/A', lines: String(lineNumber) })
    expect(blank?.file).toBe('N/A')
  })

  test('tolerates trailing whitespace after the json fence', () => {
    const output = 'Text\n```json   \n[{"severity": "error", "file": "test.rb"}]   \n```\n'

    expect(parseReviewOutput(output)).toHaveLength(1)
  })

  test('uses only the first json block', () => {
    const firstFile = 'first.rb'
    const output = jsonBlock(JSON.stringify([{ file: firstFile }])) + 'text\n' + jsonBlock(JSON.stringify([{ file: 'second.rb' }]))

    expect(parseReviewOutput(output).map((item) => item.file)).toEqual([firstFile])
  })
})
