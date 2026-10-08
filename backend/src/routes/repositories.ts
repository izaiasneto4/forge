import { Elysia } from 'elysia'
import { dirname } from 'node:path'
import { RepositoriesResponse } from '../contracts/ui-payloads'
import { ok } from '../http/envelope'
import { mergeParams, requireStringParam } from '../http/params'
import { rubyBasename } from '../lib/ruby'
import { SettingStore } from '../models/setting'
import { pullRequestBoardPayload, repositoriesPayload } from '../presenters/ui-payloads'
import { GithubCliError } from '../services/github-cli-client'
import { resolveRepoSlug } from '../services/repo-switch-resolver'
import { inspectRepositoryFolder } from '../services/repository-setup'
import { SyncAdapterError } from '../services/sync/github-adapter'
import { renderError, type RouteDependencies } from './shared'

const REPO_SLUG = /^[^/]+\/[^/]+$/

export function repositoryRoutes({ ctx, services }: RouteDependencies) {
  const settings = new SettingStore(ctx.db)

  // Makes `repoPath` the current repo, then syncs it.
  async function trackRepository(repoPath: string, slug: string, trigger: 'repo_add' | 'repo_switch') {
    const verb = trigger === 'repo_add' ? 'Added' : 'Switched to'
    settings.setCurrentRepo(repoPath)

    try {
      const result = await services.runSync(ctx, { repoPath, trigger })
      return ok({
        message: `${verb} ${rubyBasename(repoPath)} and synced`,
        repo_path: repoPath,
        repo: slug,
        synced: true,
        sync: result.sync,
        repositories: await repositoriesPayload(ctx),
        board: await pullRequestBoardPayload(ctx),
      })
    } catch (error) {
      if (error instanceof GithubCliError || error instanceof SyncAdapterError) {
        renderError('sync_failed', `${trigger === 'repo_add' ? 'Added' : 'Switched'} repo but sync failed: ${error.message}`)
      }
      throw error
    }
  }

  return new Elysia({ name: 'repository-routes', prefix: '/api/v1/repositories' })
    .get('', async () => ok(await repositoriesPayload(ctx)), { response: { 200: RepositoriesResponse } })
    // Onboarding: track the checkout at `path`, keeping its parent as the
    // repos folder. A folder of several checkouts becomes the repos folder so
    // the user can pick one.
    .post('', async ({ query, body, set }) => {
      const folder = await inspectRepositoryFolder(ctx.commands, requireStringParam(mergeParams(query, body), 'path'))
      if (folder.status === 'missing') renderError('invalid_input', `${folder.path} is not a folder`)
      if (folder.status === 'not_github') renderError('invalid_input', `${rubyBasename(folder.path)} has no GitHub origin remote`)
      if (folder.status === 'empty') renderError('invalid_input', `No GitHub repositories found in ${folder.path}`)

      if (folder.status === 'several') {
        settings.setReposFolder(folder.path)
        return ok({
          message: `Found ${folder.count} repositories in ${rubyBasename(folder.path)}. Pick the one to track.`,
          synced: false,
          repositories: await repositoriesPayload(ctx),
          board: await pullRequestBoardPayload(ctx),
        })
      }

      settings.setReposFolder(dirname(folder.path))
      const response = await trackRepository(folder.path, folder.slug, 'repo_add')
      set.status = 201
      return response
    })
    // RepositoriesController#create: switch the current repo, then sync it.
    .post('/switch', async ({ query, body, set }) => {
      const slug = requireStringParam(mergeParams(query, body), 'repo')
      if (!REPO_SLUG.test(slug)) renderError('invalid_input', 'repo must be in org/repo format')

      const resolution = await resolveRepoSlug(ctx.commands, settings.reposFolder(), slug)
      if (resolution.status === 'not_found') renderError('not_found', `No local repository matched ${slug}`, 404)
      if (resolution.status === 'ambiguous') {
        renderError('conflict', `Multiple local repositories matched ${slug}`, 409, { paths: resolution.paths })
      }

      const response = await trackRepository(resolution.path, slug, 'repo_switch')
      set.status = 201
      return response
    })
}
