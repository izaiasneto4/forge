import type { CommandRunner } from './commands/runner'
import type { Db } from './db/client'
import type { JobQueue } from './jobs/queue'
import type { Broadcaster } from './realtime/broadcaster'

// Everything a model, service, job or route needs from the outside world.
// Tests build one with in-memory SQLite and recording fakes.
export interface AppContext {
  db: Db
  events: Broadcaster
  jobs: JobQueue
  commands: CommandRunner
}
