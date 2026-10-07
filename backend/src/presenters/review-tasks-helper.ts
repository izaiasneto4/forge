import { isBlank, rubyBasename, secondsBetween } from '../lib/ruby'

// Port of the ReviewTasksHelper methods the API payloads use. The CSS-class and
// CLI icon helpers only served the ERB views and have no API consumer.

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  rb: 'ruby',
  js: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  cs: 'csharp',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  json: 'json',
  md: 'markdown',
  html: 'html',
  erb: 'erb',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  sql: 'sql',
  ex: 'elixir',
  exs: 'elixir',
}

const CODE_SUGGESTION = new RegExp(
  [
    String.raw`^\s*(?:def|class|module|function|const|let|var|if|for|while|switch|return|import|export|async|await|try|catch|raise|rescue|begin|end)\b`,
    String.raw`=>|==|!=|<=|>=|\+\+|--|\|\||&&|::`,
    String.raw`^\s*[@$]?[a-zA-Z_]\w*\s*[:=]\s*.+`,
    String.raw`[{};]`,
    String.raw`^\s*<\/?[a-zA-Z][^>]*>\s*$`,
  ].join('|'),
)

const CALL_EXPRESSION = /^[\w.$]+\([^)]*\)$/

export function severityEmoji(severity: string | null | undefined) {
  switch (severity ?? '') {
    case 'critical':
    case 'error':
      return '🚨'
    case 'major':
    case 'warning':
      return '⚠️'
    case 'minor':
      return 'ℹ️'
    case 'suggestion':
      return '💡'
    case 'nitpick':
      return '🔍'
    default:
      return '💬'
  }
}

export function formatReviewDuration(startedAt: Date | null, completedAt: Date | null) {
  if (!startedAt || !completedAt) return null

  const seconds = Math.trunc(secondsBetween(completedAt, startedAt))
  if (seconds < 60) return `${seconds}s`

  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remainder = seconds % 60
    return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

// Ruby `File.extname`: leading dots of the basename don't start an extension.
function rubyExtname(path: string) {
  const name = rubyBasename(path).replace(/^\.+/, '')
  const dotIndex = name.lastIndexOf('.')
  return dotIndex > 0 ? name.slice(dotIndex) : ''
}

// Unknown extensions come back as-is, so a file without one yields "".
export function detectLanguageFromFile(filename: string | null | undefined) {
  if (isBlank(filename)) return null
  const extension = rubyExtname(filename).toLowerCase().replaceAll('.', '')
  return EXTENSION_LANGUAGE_MAP[extension] ?? extension
}

export function codeSuggestion(suggestion: string | null | undefined) {
  if (isBlank(suggestion)) return false
  if (suggestion.includes('```')) return true

  const lines = suggestion
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const [firstLine] = lines
  if (firstLine === undefined) return false

  if (lines.some((line) => CODE_SUGGESTION.test(line))) return true
  return lines.length === 1 && CALL_EXPRESSION.test(firstLine)
}
