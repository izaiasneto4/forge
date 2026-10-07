export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
  success: boolean
}

export interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  // Written to stdin, which is then closed (Open3's stdin_data).
  input?: string
  // Kills the process and throws CommandTimeoutError when exceeded.
  timeoutMs?: number
  // Streams combined stdout+stderr line by line (Open3.popen2e); `stdout` then
  // holds the combined output and `stderr` is empty.
  onOutputLine?: (line: string) => void
}

export class CommandTimeoutError extends Error {
  constructor(readonly command: string[], readonly timeoutMs: number) {
    super(`Command timed out after ${timeoutMs / 1000}s: ${command.join(' ')}`)
  }
}

// Thrown when the executable is missing (Ruby raises Errno::ENOENT).
export class CommandNotFoundError extends Error {
  constructor(readonly command: string[]) {
    super(`No such file or directory - ${command[0]}`)
  }
}

export interface CommandRunner {
  run(command: string[], options?: RunOptions): Promise<CommandResult>
}

async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const decoder = new TextDecoder()
  let buffered = ''
  let collected = ''
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true })
    collected += text
    buffered += text
    let newline = buffered.indexOf('\n')
    while (newline !== -1) {
      onLine(buffered.slice(0, newline + 1))
      buffered = buffered.slice(newline + 1)
      newline = buffered.indexOf('\n')
    }
  }
  if (buffered !== '') onLine(buffered)
  return collected
}

function spawnProcess(command: string[], options: RunOptions) {
  try {
    return Bun.spawn(command, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : undefined,
      stdin: options.input === undefined ? 'ignore' : new Blob([options.input]),
      stdout: 'pipe',
      stderr: 'pipe',
    })
  } catch {
    throw new CommandNotFoundError(command)
  }
}

export const bunCommandRunner: CommandRunner = {
  async run(command, options = {}) {
    const child = spawnProcess(command, options)

    let timedOut = false
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            child.kill()
          }, options.timeoutMs)

    try {
      if (options.onOutputLine) {
        const onLine = options.onOutputLine
        const [stdout, stderr, exitCode] = await Promise.all([
          readLines(child.stdout, onLine),
          readLines(child.stderr, onLine),
          child.exited,
        ])
        if (timedOut && options.timeoutMs !== undefined) throw new CommandTimeoutError(command, options.timeoutMs)
        return { stdout: stdout + stderr, stderr: '', exitCode, success: exitCode === 0 }
      }

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      if (timedOut && options.timeoutMs !== undefined) throw new CommandTimeoutError(command, options.timeoutMs)
      return { stdout, stderr, exitCode, success: exitCode === 0 }
    } finally {
      clearTimeout(timer)
    }
  },
}
