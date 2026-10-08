import { Interrupt, start } from './cli'

// The `ordem` CLI process: bin/ordem.ts and the desktop sidecar's `cli` mode both run this.
export async function runCli(args: string[]) {
  const interrupt = new AbortController()
  const onInterrupt = () => interrupt.abort()
  process.on('SIGINT', onInterrupt)

  try {
    process.exitCode = await start(args, { signal: interrupt.signal })
  } catch (error) {
    if (!(error instanceof Interrupt)) throw error

    // An Interrupt Ruby doesn't rescue kills the process with the signal itself.
    process.off('SIGINT', onInterrupt)
    process.kill(process.pid, 'SIGINT')
  } finally {
    process.off('SIGINT', onInterrupt)
  }
}
