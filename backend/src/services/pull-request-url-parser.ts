import { isBlank } from '../lib/ruby'

export interface ParsedPullRequestUrl {
  url: string
  owner: string
  name: string
  number: number
  repo: string
}

const GITHUB_PR_URL = /^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<name>[^/]+)\/pull\/(?<number>\d+)(?:\/.*)?$/

// Ruby `Integer("0042")` reads a leading zero as octal and rejects "08"/"09".
function rubyInteger(digits: string) {
  if (!/^0[0-7]+$/.test(digits) && /^0\d/.test(digits)) throw new RangeError(`invalid value for Integer(): "${digits}"`)
  return /^0\d/.test(digits) ? Number.parseInt(digits, 8) : Number.parseInt(digits, 10)
}

// Port of PullRequestUrlParser.parse: canonical PR URL and its parts, or null.
export function parsePullRequestUrl(url: string | null | undefined): ParsedPullRequestUrl | null {
  if (isBlank(url)) return null

  const groups = GITHUB_PR_URL.exec(url)?.groups
  const owner = groups?.owner
  const name = groups?.name
  const number = groups?.number
  if (owner === undefined || name === undefined || number === undefined) return null

  return {
    url: `https://github.com/${owner}/${name}/pull/${number}`,
    owner,
    name,
    number: rubyInteger(number),
    repo: `${owner}/${name}`,
  }
}
