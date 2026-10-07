import { Elysia } from 'elysia'
import { existsSync, statSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'

// Replaces FrontendController, Rails' public file server, /up and the 404 page.
export const SPA_ROUTES = ['/', '/review_tasks', '/review_tasks/:id', '/repositories', '/settings', '/new']
// Mailbox views, optionally with a numeric pull request id: /inbox, /reviewing/12.
export const MAILBOX_ROUTE = /^\/(inbox|reviewing|waiting|mine|settled)(\/\d+)?$/
const UP_HTML = '<!DOCTYPE html><html><body style="background-color: green"></body></html>'

export interface FrontendOptions {
  publicDir: string
  development: boolean
  frontendDevUrl: string
}

function isFile(path: string) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

// Maps a URL path to a file inside `publicDir`, refusing anything that escapes it.
export function publicFilePath(publicDir: string, urlPath: string) {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const candidate = normalize(join(publicDir, decoded))
  if (candidate !== publicDir && !candidate.startsWith(`${publicDir}${sep}`)) return null
  return isFile(candidate) ? candidate : null
}

function serveFile(path: string, cacheSeconds: number) {
  return new Response(Bun.file(path), { headers: { 'cache-control': `public, max-age=${cacheSeconds}` } })
}

function spaIndex(options: FrontendOptions, request: Request) {
  const index = join(options.publicDir, 'frontend', 'index.html')
  if (existsSync(index)) return new Response(Bun.file(index), { headers: { 'content-type': 'text/html; charset=utf-8' } })

  if (options.development) {
    const url = new URL(request.url)
    return Response.redirect(`${options.frontendDevUrl}${url.pathname}${url.search}`, 302)
  }
  return new Response('Frontend build not found', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

function notFound(options: FrontendOptions) {
  const page = join(options.publicDir, '404.html')
  if (existsSync(page)) return new Response(Bun.file(page), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } })
  return new Response('Not Found', { status: 404 })
}

export function frontendRoutes(options: FrontendOptions) {
  // Rails: 2 days in development, a year in production.
  const cacheSeconds = options.development ? 2 * 24 * 3600 : 365 * 24 * 3600
  let app = new Elysia({ name: 'frontend' }).get('/up', () => new Response(UP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
  for (const route of SPA_ROUTES) app = app.get(route, ({ request }) => spaIndex(options, request))

  // Mailbox views (served here because their paths are dynamic), static files under public/, then the public 404 page.
  return app.all('*', ({ request }) => {
    const url = new URL(request.url)
    const isRead = request.method === 'GET' || request.method === 'HEAD'
    if (isRead && MAILBOX_ROUTE.test(url.pathname)) return spaIndex(options, request)
    const file = isRead ? publicFilePath(options.publicDir, url.pathname) : null
    return file ? serveFile(file, cacheSeconds) : notFound(options)
  })
}
