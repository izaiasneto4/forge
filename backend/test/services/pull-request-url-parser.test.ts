import { describe, expect, test } from 'bun:test'
import { parsePullRequestUrl } from '../../src/services/pull-request-url-parser'

const owner = 'acme'
const name = 'api'
const number = 42
const canonicalUrl = `https://github.com/${owner}/${name}/pull/${number}`

describe('parsePullRequestUrl', () => {
  test('parses a valid GitHub pull request URL', () => {
    const parsed = parsePullRequestUrl(canonicalUrl)

    expect(parsed).toEqual({ url: canonicalUrl, owner, name, number, repo: `${owner}/${name}` })
  })

  test('parses a URL with a trailing path and canonicalizes it', () => {
    const parsed = parsePullRequestUrl(`${canonicalUrl}/files`)

    expect(parsed?.number).toBe(number)
    expect(parsed?.url).toBe(canonicalUrl)
  })

  test('accepts plain http', () => {
    const parsed = parsePullRequestUrl(canonicalUrl.replace('https://', 'http://'))

    expect(parsed?.url).toBe(canonicalUrl)
  })

  test.each(['https://example.com/foo', '', '   ', null, undefined, `${canonicalUrl}x`, `prefix ${canonicalUrl}`])(
    'returns null for %p',
    (url) => {
      expect(parsePullRequestUrl(url)).toBeNull()
    },
  )

  test('reads a zero-padded number the way Ruby Integer() does', () => {
    const octalDigits = '017'

    expect(parsePullRequestUrl(`https://github.com/${owner}/${name}/pull/${octalDigits}`)?.number).toBe(Number.parseInt(octalDigits, 8))
    expect(() => parsePullRequestUrl(`https://github.com/${owner}/${name}/pull/089`)).toThrow(RangeError)
  })
})
