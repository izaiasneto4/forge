#!/usr/bin/env bun
import { Interrupt, start } from '../src/cli/cli'

const interrupt = new AbortController()
const onInterrupt = () => interrupt.abort()
process.on('SIGINT', onInterrupt)

try {
  process.exitCode = await start(process.argv.slice(2), { signal: interrupt.signal })
} catch (error) {
  if (!(error instanceof Interrupt)) throw error

  // An Interrupt Ruby doesn't rescue kills the process with the signal itself.
  process.off('SIGINT', onInterrupt)
  process.kill(process.pid, 'SIGINT')
} finally {
  process.off('SIGINT', onInterrupt)
}
