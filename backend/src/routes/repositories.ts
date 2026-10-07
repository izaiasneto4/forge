import { Elysia } from 'elysia'
import { RepositoriesResponse } from '../contracts/ui-payloads'
import { ok } from '../http/envelope'
import { mergeParams, requireStringParam } from '../http/params'
import { rubyBasename } from '../lib/ruby'
import { SettingStore } from '../models/setting'
import { pullRequestBoardPayload, repositoriesPayload } from '../presenters/ui-payloads'
import { GithubCliError } from '../services/github-cli-client'
import { resolveRepoSlug } from '../services/repo-switch-resolver'
import { SyncAdapterError } from '../services/sync/github-adapter'
import { renderError, type RouteDependencies } from './shared'

const REPO_SLUG = /^[^/]+\/[^/]+$/

export function repositoryRoutes({ ctx, services }: RouteDependencies) {
  const settings = new SettingStore(ctx.db)

  return new Elysia({ name: 'repository-routes', prefix: '/api/v1/repositories' })
    .get('', async () => ok(await repositoriesPayload(ctx)), { response: { 200: RepositoriesResponse } })
    // RepositoriesController#create: switch the current repo, then sync it.
    .post('/switch', async ({ query, body, set }) => {
      const slug = requireStringParam(mergeParams(query, body), 'repo')
      if (!REPO_SLUG.test(slug)) renderError('invalid_input', 'repo must be in org/repo format')

      const resolution = await resolveRepoSlug(settings.reposFolder(), slug)
      if (resolution.status === 'not_found') renderError('not_found', `No local repository matched ${slug}`, 404)
      if (resolution.status === 'ambiguous') {
        renderError('conflict', `Multiple local repositories matched ${slug}`, 409, { paths: resolution.paths })
      }

      const repoPath = resolution.path
      settings.setCurrentRepo(repoPath)

      try {
        const result = await services.runSync(ctx, { repoPath, trigger: 'repo_switch' })
        set.status = 201
        return ok({
          message: `Switched to ${rubyBasename(repoPath)} and synced`,
          repo_path: repoPath,
          repo: slug,
          synced: true,
          sync: result.sync,
          repositories: await repositoriesPayload(ctx),
          board: await pullRequestBoardPayload(ctx),
        })
      } catch (error) {
        if (error instanceof GithubCliError || error instanceof SyncAdapterError) {
          renderError('sync_failed', `Switched repo but sync failed: ${error.message}`)
        }
        throw error
      }
    })
}
