import { existsSync, realpathSync } from 'node:fs'
import { dirname, normalize, resolve, sep } from 'node:path'

// Port of PathValidator: guards filesystem paths handed to git/gh subprocesses.
export const MAX_PATH_LENGTH = 4096

function validInput(path: unknown): path is string {
  return typeof path === 'string' && path !== '' && path.length <= MAX_PATH_LENGTH
}

function containsTraversal(path: string) {
  return path.includes('..') || path.includes('\0')
}

function realpath(path: string) {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

function within(path: string, base: string) {
  return path === base || path.startsWith(`${base}${sep}`)
}

// Pathname#cleanpath: lexical cleanup that keeps relative paths relative.
function cleanpath(path: string) {
  const normalized = normalize(path)
  return normalized.length > 1 && normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized
}

// An existing path, resolved through symlinks; null if missing or outside `allowedBase`.
export function validatePath(path: unknown, allowedBase?: string | null): string | null {
  if (!validInput(path) || containsTraversal(path)) return null
  const resolved = realpath(path)
  if (resolved === null) return null
  if (allowedBase) {
    const base = realpath(allowedBase)
    if (base === null || !within(resolved, base)) return null
  }
  return resolved
}

function existingAncestor(path: string) {
  let current = resolve(path)
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current || parent === '/' || parent === '.') return null
    current = parent
  }
  return realpath(current)
}

// A path that may not exist yet: its nearest existing ancestor must be inside
// `allowedBase`. Rails compared with a bare prefix; this also requires a path
// separator so a sibling like "/repo-other" no longer passes for "/repo".
export function validateNewPath(path: unknown, allowedBase?: string | null): string | null {
  if (!validInput(path) || containsTraversal(path)) return null
  const ancestor = existingAncestor(path)
  if (ancestor === null) return null
  if (allowedBase) {
    const base = realpath(allowedBase)
    if (base === null || !within(ancestor, base)) return null
  }
  return cleanpath(path)
}
