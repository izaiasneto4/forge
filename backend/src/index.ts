import { runtimeConfig } from './config'
import { logger } from './lib/logger'
import { startServer } from './server'

const config = runtimeConfig(process.env)

// Run from the app root, so relative repo paths stored in settings resolve as before.
// The desktop app runs from a read-only bundle and keeps the home directory the shell gave it.
if (config.mode === 'server') process.chdir(config.appRoot)

// ORDEM_DISABLE_JOB_WORKER=1 queues jobs without running them.
const server = startServer({ config, jobWorker: (process.env.ORDEM_DISABLE_JOB_WORKER ?? process.env.FORGE_DISABLE_JOB_WORKER) !== '1' })

logger.info(`Ordem (${config.mode}) on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${server.port} (db: ${config.databasePath})`)

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  logger.info(`Received ${signal}, shutting down`)
  await server.stop()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
// Windows has no SIGTERM; Ctrl-Break and console close arrive as SIGBREAK.
process.on('SIGBREAK', () => void shutdown('SIGBREAK'))
