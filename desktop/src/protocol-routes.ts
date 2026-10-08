import { statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'

// How ordem://app/<path> maps onto the web build in public/. Pure apart from
// stat calls, so it is unit-tested without Electron.

export const APP_SCHEME = 'ordem'
export const DEV_APP_SCHEME = 'ordem-dev'
export const APP_HOST = 'app'
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/`
export const DEV_APP_URL = `${DEV_APP_SCHEME}://${APP_HOST}/`

// The renderer talks to the sidecar on 127.0.0.1 and loads avatars from GitHub.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

export function mimeType(path: string) {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

export type ProtocolRoute = { kind: 'file'; path: string } | { kind: 'index'; path: string } | { kind: 'not-found' }

function isFile(path: string) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

// A path ending in an extension is an asset; a miss there is a 404, not the SPA.
export function looksLikeAsset(pathname: string) {
  return /\.[a-z0-9]+$/i.test(pathname)
}

export function indexPath(publicDir: string) {
  return join(publicDir, 'frontend', 'index.html')
}

// Maps a URL path to a file inside publicDir, refusing anything that escapes it.
export function publicFile(publicDir: string, pathname: string) {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const root = normalize(publicDir)
  const candidate = normalize(join(root, decoded))
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null
  return isFile(candidate) ? candidate : null
}

export function resolveProtocolRoute(url: URL, publicDir: string): ProtocolRoute {
  if (url.host !== APP_HOST) return { kind: 'not-found' }
  const file = url.pathname === '/' ? null : publicFile(publicDir, url.pathname)
  if (file) return { kind: 'file', path: file }
  if (looksLikeAsset(url.pathname)) return { kind: 'not-found' }
  return { kind: 'index', path: indexPath(publicDir) }
}

// Development: Vite serves everything under its base (/frontend/), the
// repository's public/ files come from disk, and SPA routes get Vite's index.
export type DevProtocolRoute = { kind: 'proxy'; url: string } | ProtocolRoute

export function resolveDevProtocolRoute(url: URL, publicDir: string, devServerUrl: string): DevProtocolRoute {
  if (url.host !== APP_HOST) return { kind: 'not-found' }
  const base = devServerUrl.replace(/\/+$/, '')
  if (url.pathname.startsWith('/frontend/')) return { kind: 'proxy', url: `${base}${url.pathname}${url.search}` }
  const file = url.pathname === '/' ? null : publicFile(publicDir, url.pathname)
  if (file) return { kind: 'file', path: file }
  if (looksLikeAsset(url.pathname)) return { kind: 'not-found' }
  return { kind: 'proxy', url: `${base}/frontend/` }
}
