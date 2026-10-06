import type { Db } from '../../src/db/client'
import { pullRequests } from '../../src/db/schema'

let nextGithubId = 1

export function insertPullRequest(db: Db, attributes: { repoOwner: string; repoName: string }) {
  const githubId = nextGithubId++
  const now = new Date()

  return db
    .insert(pullRequests)
    .values({
      githubId,
      number: githubId,
      title: `Pull request ${githubId}`,
      url: `https://github.com/${attributes.repoOwner}/${attributes.repoName}/pull/${githubId}`,
      reviewStatus: 'pending_review',
      createdAt: now,
      updatedAt: now,
      ...attributes,
    })
    .returning()
    .get()
}
