import { literals } from './literals'

// Rails.logger stand-in. Quiet under `bun test` unless FORGE_LOG_LEVEL is set.
const LEVELS = literals('debug', 'info', 'warn', 'error', 'silent')
type Level = (typeof LEVELS)[number]

function configuredLevel(): Level {
  const requested = process.env.FORGE_LOG_LEVEL
  const match = LEVELS.find((level) => level === requested)
  if (match) return match
  return process.env.NODE_ENV === 'test' ? 'silent' : 'info'
}

function enabled(level: Level) {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(configuredLevel())
}

export const logger = {
  debug: (message: string) => enabled('debug') && console.debug(message),
  info: (message: string) => enabled('info') && console.info(message),
  warn: (message: string) => enabled('warn') && console.warn(message),
  error: (message: string) => enabled('error') && console.error(message),
}
