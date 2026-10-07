import type { CommandResult, CommandRunner, RunOptions } from '../../src/commands/runner'
import type { AppContext } from '../../src/context'
import { JobQueue } from '../../src/jobs/queue'
import type { BroadcastMessage, Broadcaster } from '../../src/realtime/broadcaster'
import { createTestDatabase } from './database'

export class RecordingBroadcaster implements Broadcaster {
  readonly messages: Array<{ stream: string; message: BroadcastMessage }> = []

  broadcast(stream: string, message: BroadcastMessage) {
    this.messages.push({ stream, message })
  }

  on(stream: string) {
    return this.messages.filter((entry) => entry.stream === stream).map((entry) => entry.message)
  }

  clear() {
    this.messages.length = 0
  }
}

export interface RecordedCommand {
  command: string[]
  options: RunOptions
}

type CommandHandler = (command: string[], options: RunOptions) => Partial<CommandResult> | Promise<Partial<CommandResult>>

// Scripted stand-in for subprocesses. Register handlers by command prefix; the
// first match wins. Unmatched commands fail loudly so tests can't silently pass.
export class FakeCommandRunner implements CommandRunner {
  readonly calls: RecordedCommand[] = []
  private readonly handlers: Array<{ prefix: string[]; handler: CommandHandler }> = []

  on(prefix: string[], handler: CommandHandler | Partial<CommandResult>) {
    this.handlers.push({ prefix, handler: typeof handler === 'function' ? handler : () => handler })
    return this
  }

  async run(command: string[], options: RunOptions = {}): Promise<CommandResult> {
    this.calls.push({ command, options })
    const match = this.handlers.find(({ prefix }) => prefix.every((part, index) => command[index] === part))
    if (!match) throw new Error(`FakeCommandRunner: no handler for ${JSON.stringify(command)}`)

    const result = await match.handler(command, options)
    const stdout = result.stdout ?? ''
    if (options.onOutputLine) {
      for (const line of stdout.split(/(?<=\n)/)) if (line !== '') options.onOutputLine(line)
    }
    const exitCode = result.exitCode ?? (result.success === false ? 1 : 0)
    return { stdout, stderr: result.stderr ?? '', exitCode, success: result.success ?? exitCode === 0 }
  }

  commandsMatching(prefix: string[]) {
    return this.calls.filter(({ command }) => prefix.every((part, index) => command[index] === part))
  }
}

export interface TestContext extends AppContext {
  events: RecordingBroadcaster
  commands: FakeCommandRunner
}

export function createTestContext(): TestContext {
  const db = createTestDatabase()
  return { db, events: new RecordingBroadcaster(), jobs: new JobQueue(db), commands: new FakeCommandRunner() }
}
