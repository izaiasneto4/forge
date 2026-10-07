import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { pullRequests } from '../../db/schema'

const PULL_REQUEST_URL = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
const GITHUB_ID_SPACE = 2n ** 62n

// Rails' extract_github_id: SHA-256 of "owner/repo/number" (or of the whole URL
// when it isn't a PR URL) modulo 2**62, so the same PR always maps to one id.
export function extractGithubId(url: string): bigint {
  const match = PULL_REQUEST_URL.exec(url)
  const source = match ? `${match[1] ?? ''}/${match[2] ?? ''}/${match[3] ?? ''}` : url
  return BigInt(`0x${createHash('sha256').update(source).digest('hex')}`) % GITHUB_ID_SPACE
}

// github_id values go past 2**53, and bun:sqlite reads them back as rounded
// numbers. Lookups and writes bind the exact BigInt so they keep matching the
// rows Rails wrote to the shared database.
export const exactGithubIdColumn = sql<string | null>`CAST(${pullRequests.githubId} AS TEXT)`

export function githubIdNumber(githubId: bigint) {
  return Number(githubId)
}

// `PullRequest.unscoped.find_by(github_id:)`.
export function findPullRequestByGithubId(db: Db, githubId: bigint) {
  return db.select().from(pullRequests).where(sql`${pullRequests.githubId} = ${githubId}`).get()
}

export function writeExactGithubId(db: Db, pullRequestId: number, githubId: bigint) {
  db.update(pullRequests).set({ githubId: sql`${githubId}` }).where(eq(pullRequests.id, pullRequestId)).run()
}
