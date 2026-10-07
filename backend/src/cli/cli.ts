import { ApiError, Client, ConnectionError, DEFAULT_API_URL, type OrdemApi, Interrupt } from './client'
import {
  dump,
  listResult,
  logsResult,
  puts,
  reviewResult,
  rubyArray,
  rubyFetch,
  rubyIndex,
  rubyInspect,
  rubyToS,
  rubyTruthy,
  statusResult,
  switchResult,
  syncResult,
  type Writer,
} from './formatter'

// Port of the original Ruby CLI, including the slice of Ruby's
// OptionParser it leans on: permuted operands, unique-prefix completion,
// bundled short flags, Integer arguments, --help/--version and its error texts.

export { Interrupt }

const PROGRAM_NAME = 'ordem'
const FOLLOW_INTERVAL_SECONDS = 2

export type Sleep = (seconds: number) => Promise<void> | void

export interface CliOptions {
  stdout?: Writer
  stderr?: Writer
  env?: Record<string, string | undefined>
  sleep?: Sleep
  // Aborted on SIGINT; the default client and sleep turn it into an Interrupt.
  signal?: AbortSignal
  createClient?: (baseUrl: string) => OrdemApi
}

export function start(argv: readonly string[], options: CliOptions = {}) {
  return new Cli(argv, options).run()
}

export function interruptibleSleep(signal?: AbortSignal): Sleep {
  return (seconds) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new Interrupt())

      const onAbort = () => {
        clearTimeout(timer)
        reject(new Interrupt())
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, seconds * 1000)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
}

class Cli {
  private argv: string[]
  private readonly stdout: Writer
  private readonly stderr: Writer
  private readonly sleep: Sleep
  private readonly client: OrdemApi
  private readonly posixlyCorrect: boolean

  constructor(
    argv: readonly string[],
    {
      stdout = process.stdout,
      stderr = process.stderr,
      env = process.env,
      signal,
      sleep = interruptibleSleep(signal),
      createClient = (baseUrl) => new Client({ baseUrl, signal }),
    }: CliOptions,
  ) {
    this.argv = [...argv]
    this.stdout = stdout
    this.stderr = stderr
    this.sleep = sleep
    this.client = createClient(env.ORDEM_API_URL ?? DEFAULT_API_URL)
    this.posixlyCorrect = env.POSIXLY_CORRECT !== undefined
  }

  async run(): Promise<number> {
    try {
      const command = this.argv.shift()
      if (command === undefined) return this.writeError('Usage: ordem <command>')

      switch (command) {
        case 'sync':
          return await this.runSync()
        case 'review':
          return await this.runReview()
        case 'status':
          return await this.runStatus()
        case 'list':
          return await this.runList()
        case 'logs':
          return await this.runLogs()
        case 'repo':
          return await this.runRepo()
        default:
          return this.writeError(`Unknown command: ${command}`)
      }
    } catch (error) {
      if (error instanceof OptionParseError) return this.writeError(error.message)
      if (error instanceof OptionExit) return error.deliver(this.stdout, this.stderr)
      if (error instanceof ConnectionError) {
        puts(this.stderr, `Connection error: ${error.message}`)
        return 2
      }
      if (error instanceof ApiError) {
        puts(this.stderr, `API error (${rubyToS(error.code)}): ${error.message}`)
        return 1
      }
      throw error
    }
  }

  private async runSync() {
    const options = { force: false, json: false }
    this.parseOptions((parser) => {
      parser.flag('force', () => (options.force = true))
      parser.flag('json', () => (options.json = true))
    })

    const result = await this.client.sync({ force: options.force })
    dump(options.json, options.json ? result : syncResult(result), this.stdout)
    return 0
  }

  private async runReview() {
    const options: { client?: string; type?: string; json: boolean } = { json: false }
    this.parseOptions((parser) => {
      parser.string('client', 'CLIENT', (value) => (options.client = value))
      parser.string('type', 'TYPE', (value) => (options.type = value))
      parser.flag('json', () => (options.json = true))
    })

    const prUrl = this.argv.shift()
    if (prUrl === undefined) return this.writeError('Usage: ordem review <pr-url>')

    const result = await this.client.review({ prUrl, cliClient: options.client, reviewType: options.type })
    dump(options.json, options.json ? result : reviewResult(result), this.stdout)
    return 0
  }

  private async runStatus() {
    const options = { json: false }
    this.parseOptions((parser) => parser.flag('json', () => (options.json = true)))

    const result = await this.client.status()
    dump(options.json, options.json ? result : statusResult(result), this.stdout)
    return 0
  }

  private async runList() {
    const options: { status?: string; limit?: bigint; json: boolean } = { json: false }
    this.parseOptions((parser) => {
      parser.string('status', 'STATUS', (value) => (options.status = value))
      parser.integer('limit', 'LIMIT', (value) => (options.limit = value))
      parser.flag('json', () => (options.json = true))
    })

    const result = await this.client.list({ status: options.status, limit: options.limit })
    dump(options.json, options.json ? result : listResult(result), this.stdout)
    return 0
  }

  // Ruby rescues Interrupt for the whole command: Ctrl-C is how --follow ends.
  private async runLogs() {
    try {
      return await this.followLogs()
    } catch (error) {
      if (error instanceof Interrupt) return 0
      throw error
    }
  }

  private async followLogs(): Promise<number> {
    const options: { tail?: bigint; follow: boolean; json: boolean } = { follow: false, json: false }
    this.parseOptions((parser) => {
      parser.integer('tail', 'TAIL', (value) => (options.tail = value))
      parser.flag('follow', () => (options.follow = true))
      parser.flag('json', () => (options.json = true))
    })

    const taskId = this.argv.shift()
    if (taskId === undefined) return this.writeError('Usage: ordem logs <task-id>')

    const result = await this.client.logs({ taskId, tail: options.tail })
    dump(options.json, options.json ? result : logsResult(result), this.stdout)

    if (!options.follow) return 0
    if (options.json) return this.writeError('--follow and --json are incompatible')

    let lastId = maxLogId(rubyArray(rubyFetch(result, 'logs', [])))
    for (;;) {
      const poll = await this.client.logs({ taskId, tail: options.tail, afterId: lastId })
      const newLogs = rubyArray(rubyFetch(poll, 'logs', []))

      if (newLogs.some(rubyTruthy)) {
        puts(this.stdout, logsResult(poll))
        lastId = maxLogId(newLogs)
      }

      await this.sleep(FOLLOW_INTERVAL_SECONDS)
    }
  }

  private async runRepo() {
    const usage = 'Usage: ordem repo switch <org/repo>'
    if (this.argv.shift() !== 'switch') return this.writeError(usage)

    const options = { json: false }
    this.parseOptions((parser) => parser.flag('json', () => (options.json = true)))

    const repo = this.argv.shift()
    if (repo === undefined) return this.writeError(usage)

    const result = await this.client.switchRepo({ repo })
    dump(options.json, options.json ? result : switchResult(result), this.stdout)
    return 0
  }

  private parseOptions(define: (parser: OptionParser) => void) {
    const parser = new OptionParser()
    define(parser)
    this.argv = parser.parse(this.argv, this.posixlyCorrect)
  }

  private writeError(message: string) {
    puts(this.stderr, message)
    return 1
  }
}

// logs.map { |log| log["id"] }.max
function maxLogId(logs: unknown[]) {
  const ids = logs.map((log) => rubyIndex(log, 'id'))
  if (ids.length <= 1) return ids[0] ?? null

  const numbers = ids.filter((id) => typeof id === 'number')
  if (numbers.length === ids.length) return Math.max(...numbers)

  const strings = ids.filter((id) => typeof id === 'string')
  if (strings.length === ids.length) return strings.reduce((max, id) => (id > max ? id : max))

  throw new TypeError(`comparison of ${ids.map(rubyInspect).join(' with ')} failed`)
}

// --- OptionParser --------------------------------------------------------------

type Switch =
  | { kind: 'flag'; name: string; apply: () => void }
  | { kind: 'string'; name: string; placeholder: string; apply: (value: string) => void }
  | { kind: 'integer'; name: string; placeholder: string; apply: (value: bigint) => void }
  | { kind: 'optional'; name: string; apply: (value: string | undefined) => void }

// OptionParser's Integer acceptor; Kernel#Integer then rejects things like "08".
const INTEGER_ARGUMENT = /^[-+]?(?:0(?:[0-7]+(?:_[0-7]+)*|b[01]+(?:_[01]+)*|x[\da-f]+(?:_[\da-f]+)*)?|\d+(?:_\d+)*)$/i

const RUBY_QUOTE_ESCAPES: Record<string, string> = { ' ': '\\ ', '\t': '\\t', '\n': '\\n', '\r': '\\r', '\f': '\\f', '\v': '\\v' }

class OptionParseError extends Error {
  constructor(
    private readonly reason: string,
    private readonly args: string[],
    private readonly suggestion = '',
  ) {
    super()
    this.message = this.describe()
  }

  // ParseError#set_option: put the offending command-line argument in the message.
  setOption(arg: string, replaceFirst: boolean) {
    if (replaceFirst) this.args[0] = arg
    else this.args.unshift(arg)
    this.message = this.describe()
    return this
  }

  private describe() {
    return `${this.reason}: ${this.args.join(' ')}${this.suggestion}`
  }
}

// The built-in --help and --version print and call `exit` in the middle of parsing.
class OptionExit extends Error {
  constructor(
    readonly code: number,
    private readonly output: { stdout?: string; stderr?: string },
  ) {
    super()
  }

  deliver(stdout: Writer, stderr: Writer) {
    if (this.output.stdout !== undefined) puts(stdout, this.output.stdout)
    if (this.output.stderr !== undefined) puts(stderr, this.output.stderr)
    return this.code
  }
}

class OptionParser {
  private readonly switches: Switch[] = []
  // The shell-completion builtins (--*-completion-bash/zsh) are left out.
  private readonly builtins: Switch[] = [
    {
      kind: 'flag',
      name: 'help',
      apply: () => {
        throw new OptionExit(0, { stdout: this.help() })
      },
    },
    {
      kind: 'optional',
      name: 'version',
      apply: (pkg) => {
        const reason = pkg === undefined ? 'version unknown' : `no version found in package ${pkg}`
        throw new OptionExit(1, { stderr: `${PROGRAM_NAME}: ${reason}` })
      },
    },
  ]

  flag(name: string, apply: () => void) {
    this.switches.push({ kind: 'flag', name, apply })
  }

  string(name: string, placeholder: string, apply: (value: string) => void) {
    this.switches.push({ kind: 'string', name, placeholder, apply })
  }

  integer(name: string, placeholder: string, apply: (value: bigint) => void) {
    this.switches.push({ kind: 'integer', name, placeholder, apply })
  }

  // parse!: options may appear anywhere unless POSIXLY_CORRECT stops at the first operand.
  parse(argv: readonly string[], posixlyCorrect: boolean) {
    const pending = [...argv]
    const operands: string[] = []

    for (let arg = pending.shift(); arg !== undefined; arg = pending.shift()) {
      if (arg.startsWith('--')) {
        if (this.parseLong(arg, pending) === 'stop') break
      } else if (arg.startsWith('-') && arg.length > 1) {
        this.parseShort(arg, pending)
      } else if (posixlyCorrect) {
        pending.unshift(arg)
        break
      } else {
        operands.push(arg)
      }
    }

    return [...operands, ...pending]
  }

  private parseLong(arg: string, pending: string[]) {
    const separator = arg.indexOf('=', 2)
    const name = (separator === -1 ? arg.slice(2) : arg.slice(2, separator)).replaceAll('_', '-')
    const inline = separator === -1 ? undefined : arg.slice(separator + 1)

    // `--` is itself a switch: it ends parsing and takes no argument.
    if (name === '') {
      if (inline === undefined) return 'stop'
      throw new OptionParseError('needless argument', [inline]).setOption(arg, true)
    }

    const option = naming(arg, true, () => this.complete(name, true))
    naming(arg, inline !== undefined, () => this.consume(option, inline, pending, true))
    return 'continue'
  }

  // Short letters complete against long names (`-f` => --follow); `-fj` bundles flags.
  private parseShort(arg: string, pending: string[]) {
    const [letter = '', ...rest] = Array.from(arg.slice(1))
    const inline = rest.length > 0 ? rest.join('') : undefined
    const option = naming(arg, true, () => this.complete(letter, false))
    const rejectInline = inline === undefined || inline.startsWith('=')
    const leftover = naming(arg, Array.from(arg).length > 2, () => this.consume(option, inline, pending, rejectInline))
    if (leftover === undefined) return

    const bundled = leftover.replace(/^-*/, '-')
    if (bundled !== '-') pending.unshift(bundled)
  }

  // Applies the switch and returns what's left of a bundled short flag.
  private consume(option: Switch, inline: string | undefined, pending: string[], rejectInline: boolean) {
    switch (option.kind) {
      case 'flag':
        if (inline !== undefined && rejectInline) throw new OptionParseError('needless argument', [inline])
        option.apply()
        return inline
      case 'optional':
        option.apply(inline)
        return undefined
      case 'string':
        option.apply(requiredArgument(inline, pending))
        return undefined
      case 'integer':
        option.apply(integerArgument(requiredArgument(inline, pending)))
        return undefined
    }
  }

  // Exact name first, then a unique completion; user switches shadow the builtins.
  private complete(name: string, ignoreCase: boolean): Switch {
    const lists = [this.switches, this.builtins]
    for (const list of lists) {
      const exact = list.find((option) => option.name === name)
      if (exact) return exact
    }

    const pattern = completionPattern(name, ignoreCase)
    for (const list of lists) {
      const [shortest, ...others] = list
        .filter((option) => pattern.test(option.name))
        .sort((a, b) => a.name.length - b.name.length)
      if (shortest === undefined) continue
      if (others.every((other) => other.name.startsWith(shortest.name))) return shortest

      throw new OptionParseError('ambiguous option', [name], this.suggestionsFor(name))
    }

    throw new OptionParseError('invalid option', [name], this.suggestionsFor(name))
  }

  private suggestionsFor(name: string) {
    return didYouMean(
      name,
      [...this.switches, ...this.builtins].map((option) => option.name),
    )
  }

  private help() {
    const lines = this.switches.map((option) => {
      const placeholder = 'placeholder' in option ? ` ${option.placeholder}` : ''
      return `        --${option.name}${placeholder}`
    })
    return [`Usage: ${PROGRAM_NAME} [options]`, ...lines, ''].join('\n')
  }
}

function naming<T>(arg: string, replaceFirst: boolean, parse: () => T) {
  try {
    return parse()
  } catch (error) {
    if (error instanceof OptionParseError) error.setOption(arg, replaceFirst)
    throw error
  }
}

function requiredArgument(inline: string | undefined, pending: string[]) {
  if (inline !== undefined) return inline

  const next = pending.shift()
  if (next === undefined) throw new OptionParseError('missing argument', [])
  return next
}

function integerArgument(text: string) {
  const value = INTEGER_ARGUMENT.test(text) ? rubyInteger(text) : null
  if (value === null) throw new OptionParseError('invalid argument', [text])
  return value
}

// Kernel#Integer for literals that passed INTEGER_ARGUMENT: a leading 0 means octal.
function rubyInteger(text: string) {
  const digits = text.replace(/^[-+]/, '').replaceAll('_', '').toLowerCase()
  const octal = digits.length > 1 && digits.startsWith('0') && !/^0[bx]/.test(digits)
  if (octal && /[89]/.test(digits)) return null

  const magnitude = BigInt(octal ? `0o${digits.slice(1)}` : digits)
  return text.startsWith('-') ? -magnitude : magnitude
}

// OptionParser::Completion.regexp: every word of the key may be abbreviated.
function completionPattern(key: string, ignoreCase: boolean) {
  const quoted = key.replace(/[[\]{}()|\-*.\\?+^$#\s]/g, (char) => RUBY_QUOTE_ESCAPES[char] ?? `\\${char}`)
  return new RegExp(`^${quoted.replace(/\w+\b/g, '$&\\w*')}`, ignoreCase ? 'i' : '')
}

// --- DidYouMean (the suggestions OptionParser appends to unknown options) ------

function didYouMean(input: string, dictionary: string[]) {
  const corrections = spellCheck(input, dictionary)
  const suggestions = dictionary.filter((word) => corrections.includes(word))
  return suggestions.length === 0 ? '' : `\nDid you mean?  ${suggestions.join('\n               ')}`
}

function spellCheck(input: string, dictionary: string[]) {
  const target = normalizeWord(input)
  const targetLength = codePoints(target).length
  const threshold = targetLength > 3 ? 0.834 : 0.77
  const words = dictionary
    .filter((word) => jaroWinkler(normalizeWord(word), target) >= threshold)
    .filter((word) => word !== input)
    .sort((a, b) => jaroWinkler(a, target) - jaroWinkler(b, target))
    .reverse()

  const mistypeThreshold = Math.ceil(targetLength * 0.25)
  const mistypes = words.filter((word) => levenshtein(normalizeWord(word), target) <= mistypeThreshold)
  if (mistypes.length > 0) return mistypes

  const misspells = words.filter((word) => {
    const normalized = normalizeWord(word)
    return levenshtein(normalized, target) < Math.min(targetLength, codePoints(normalized).length)
  })
  return misspells.slice(0, 1)
}

function normalizeWord(word: string) {
  return word.toLowerCase().replaceAll('@', '')
}

function codePoints(text: string) {
  return Array.from(text, (char) => char.codePointAt(0) ?? 0)
}

function jaro(first: string, second: string) {
  let shorter = codePoints(first)
  let longer = codePoints(second)
  if (shorter.length > longer.length) [shorter, longer] = [longer, shorter]

  const range = longer.length > 3 ? Math.floor(longer.length / 2) - 1 : 0
  const shorterFlags: boolean[] = []
  const longerFlags: boolean[] = []
  let matches = 0

  shorter.forEach((char, i) => {
    for (let j = Math.max(0, i - range); j <= i + range; j++) {
      if (!longerFlags[j] && char === longer[j]) {
        longerFlags[j] = true
        shorterFlags[i] = true
        matches++
        break
      }
    }
  })
  if (matches === 0) return 0

  let transpositions = 0
  let next = 0
  shorter.forEach((char, i) => {
    if (!shorterFlags[i]) return

    let index = next
    for (let j = next; j < longer.length; j++) {
      index = j
      if (longerFlags[j]) {
        next = j + 1
        break
      }
    }
    if (char !== longer[index]) transpositions++
  })

  const halfTranspositions = Math.floor(transpositions / 2)
  return (matches / shorter.length + matches / longer.length + (matches - halfTranspositions) / matches) / 3
}

function jaroWinkler(first: string, second: string) {
  const distance = jaro(first, second)
  if (distance <= 0.7) return distance

  const secondPoints = codePoints(second)
  let prefix = 0
  for (const char of codePoints(first)) {
    if (char !== secondPoints[prefix] || prefix >= 4) break
    prefix++
  }
  return distance + prefix * 0.1 * (1 - distance)
}

function levenshtein(first: string, second: string) {
  const source = codePoints(first)
  const target = codePoints(second)
  if (source.length === 0) return target.length
  if (target.length === 0) return source.length

  const row = Array.from({ length: target.length + 1 }, (_, index) => index)
  let distance = 0
  source.forEach((char, index) => {
    let previous = index + 1
    target.forEach((targetChar, j) => {
      distance = Math.min((row[j + 1] ?? 0) + 1, previous + 1, (row[j] ?? 0) + (char === targetChar ? 0 : 1))
      row[j] = previous
      previous = distance
    })
    row[target.length] = distance
  })
  return distance
}
