import { Elysia } from 'elysia'
import type { AppContext } from './context'
import { apiRequestAuthorized, isApiPath, unauthorizedResponse, websocketHandshakeAuthorized } from './http/desktop-auth'
import { errorHandling } from './http/envelope'
import { frontendRoutes } from './http/frontend'
import { blockedHostResponse, DEFAULT_ALLOWED_HOSTS, requestHostAllowed, websocketOriginAllowed } from './http/host-authorization'
import { realtimePlugin, realtimeWebSocketOptions, RealtimeServer, WS_PATH } from './realtime/ws-server'
import { coreRoutes } from './routes/core'
import { pullRequestRoutes } from './routes/pull-requests'
import { repositoryRoutes } from './routes/repositories'
import { reviewTaskRoutes } from './routes/review-tasks'
import { settingsRoutes } from './routes/settings'
import { QueueKick, type ApiServices } from './routes/shared'
import { pickFolder } from './services/folder-picker'
import { submitReview } from './services/github-review-submitter'
import { runSync } from './services/sync/engine'

export const defaultServices: ApiServices = {
  runSync: (ctx, options) => runSync(ctx, options),
  submitReview: (ctx, task, options) => submitReview(ctx, task, options),
  pickFolder: (ctx, prompt) => pickFolder(ctx, prompt),
}

export interface AppOptions {
  ctx: AppContext
  realtime: RealtimeServer
  services?: ApiServices
  publicDir: string
  development?: boolean
  allowedHosts?: string[]
  frontendDevUrl?: string
  // Per-launch token from the desktop shell; null leaves the API open as before.
  desktopToken?: string | null
}

function isWebsocketHandshake(request: Request) {
  return new URL(request.url).pathname === WS_PATH && request.headers.get('upgrade')?.toLowerCase() === 'websocket'
}

function desktopTokenRejects(request: Request, desktopToken: string) {
  const { pathname } = new URL(request.url)
  if (pathname === WS_PATH) return !websocketHandshakeAuthorized(request, desktopToken)
  return isApiPath(pathname) && !apiRequestAuthorized(request, desktopToken)
}

export function createApp(options: AppOptions) {
  const development = options.development ?? true
  const allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS
  const desktopToken = options.desktopToken ?? null
  const deps = { ctx: options.ctx, services: options.services ?? defaultServices, queueKick: new QueueKick() }

  // normalize: false keeps Elysia from silently dropping payload keys a
  // response schema doesn't list; schemas still reject missing/mistyped keys.
  return new Elysia({ normalize: false, websocket: realtimeWebSocketOptions() })
    .onRequest(({ request }) => {
      if (!requestHostAllowed(request, allowedHosts)) return blockedHostResponse(request)
      if (isWebsocketHandshake(request) && !websocketOriginAllowed(request, { development })) {
        return new Response('Request origin not allowed', { status: 404 })
      }
      if (desktopToken !== null && desktopTokenRejects(request, desktopToken)) return unauthorizedResponse()
      return undefined
    })
    .use(errorHandling)
    .use(realtimePlugin(options.realtime))
    .use(coreRoutes(deps))
    .use(settingsRoutes(deps))
    .use(pullRequestRoutes(deps))
    .use(reviewTaskRoutes(deps))
    .use(repositoryRoutes(deps))
    .use(frontendRoutes({ publicDir: options.publicDir, development, frontendDevUrl: options.frontendDevUrl ?? 'http://localhost:5173' }))
}

export type App = ReturnType<typeof createApp>
