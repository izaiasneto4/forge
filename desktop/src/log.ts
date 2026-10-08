import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

// Size-rotated log files: server.log, then server.log.1 (newest) to .N (oldest).
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
export const DEFAULT_KEEP = 3

export interface RotatingLogOptions {
  maxBytes?: number
  keep?: number
}

export function shouldRotate(currentBytes: number, incomingBytes: number, maxBytes: number) {
  return currentBytes > 0 && currentBytes + incomingBytes > maxBytes
}

export function rotatedPath(path: string, index: number) {
  return `${path}.${index}`
}

export class RotatingLog {
  private readonly maxBytes: number
  private readonly keep: number
  private size: number

  constructor(
    readonly path: string,
    options: RotatingLogOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.keep = options.keep ?? DEFAULT_KEEP
    mkdirSync(dirname(path), { recursive: true })
    this.size = existsSync(path) ? statSync(path).size : 0
  }

  write(chunk: string | Uint8Array) {
    const bytes = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength
    if (shouldRotate(this.size, bytes, this.maxBytes)) this.rotate()
    try {
      appendFileSync(this.path, chunk)
      this.size += bytes
    } catch {
      // Logging must never take the app down (disk full, permissions).
    }
  }

  line(message: string) {
    this.write(`[${new Date().toISOString()}] ${message}\n`)
  }

  private rotate() {
    try {
      rmSync(rotatedPath(this.path, this.keep), { force: true })
      for (let index = this.keep - 1; index >= 1; index -= 1) {
        const from = rotatedPath(this.path, index)
        if (existsSync(from)) renameSync(from, rotatedPath(this.path, index + 1))
      }
      if (existsSync(this.path)) renameSync(this.path, rotatedPath(this.path, 1))
    } catch {
      // Keep appending to the current file if rotation fails.
    }
    this.size = existsSync(this.path) ? statSync(this.path).size : 0
  }
}
