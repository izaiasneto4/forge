import { and, eq, isNull } from 'drizzle-orm'
import type { AppContext } from '../context'
import type { Db } from '../db/client'
import { pullRequests } from '../db/schema'
import { isBlank } from '../lib/ruby'
import { SettingStore } from '../models/setting'
import { isDirectory } from './git'
import { resolveRepoSlug } from './repo-switch-resolver'

function activeRemoteRepoSlugs(db: Db) {
  const rows = db
    .selectDistinct({ owner: pullRequests.repoOwner, name: pullRequests.repoName })
    .from(pullRequests)
    .where(
      and(
        isNull(pullRequests.deletedAt),
        eq(pullRequests.archived, false),
        eq(pullRequests.remoteState, 'open'),
        isNull(pullRequests.inactiveReason),
      ),
    )
    .all()

  return [...new Set(rows.map(({ owner, name }) => `${owner ?? ''}/${name ?? ''}`))]
}

// When the saved current repo is missing, re-points it at the only repo that
// still has open PRs, if exactly one local checkout matches.
export async function recoverCurrentRepo({ db, commands }: Pick<AppContext, 'db' | 'commands'>): Promise<string | null> {
  const settingStore = new SettingStore(db)
  const currentRepo = settingStore.currentRepo()
  if (!isBlank(currentRepo) && isDirectory(currentRepo)) {
    return currentRepo
  }

  const reposFolder = settingStore.reposFolder()
  if (isBlank(reposFolder)) {
    return null
  }

  const [onlySlug, ...otherSlugs] = activeRemoteRepoSlugs(db)
  if (onlySlug === undefined || otherSlugs.length > 0) {
    return null
  }

  const resolution = await resolveRepoSlug(commands, reposFolder, onlySlug)
  if (resolution.status !== 'ok') {
    return null
  }

  settingStore.setCurrentRepo(resolution.path)
  return resolution.path
}
