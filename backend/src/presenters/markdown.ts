import { Marked, Tokenizer, type RendererObject, type TokenizerObject, type Tokens } from 'marked'
import { isBlank } from '../lib/ruby'

// Port of ReviewTasksHelper#render_markdown / #render_code_block. Rails used
// Redcarpet (hard_wrap, fenced_code_blocks, autolink, tables, strikethrough,
// lax_spacing, space_after_headers, no_intra_emphasis) with a Rouge-highlighted
// code wrapper. The block renderers below reproduce Redcarpet's HTML layout.
// Code is emitted HTML-escaped without Rouge token spans: the frontend CSS only
// styles `.code-block` / `pre.highlight`, never the token classes.
//
// Like Redcarpet without :escape_html/:filter_html, raw HTML in the markdown is
// passed through untouched.

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

// ERB::Util.html_escape
export function htmlEscape(text: string) {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character)
}

// Rouge's HTML formatter escapes only &, < and >.
function escapeCode(code: string) {
  return code.replace(/[&<>]/g, (character) => HTML_ESCAPES[character] ?? character)
}

// One wrapper for fenced markdown blocks and standalone suggestions, styled by
// the frontend's `.code-block` rules; its copy button reads `data-copy`. Unlike
// the Ruby helper, the language label is escaped: it comes straight from the AI's
// fence info string.
function codeBlock(code: string, language: string) {
  const label = htmlEscape(language)
  return `<div class="code-block"><div class="code-head"><span>${label}</span><button type="button" class="copy-btn" data-copy="${htmlEscape(code)}">Copy</button></div><pre class="highlight"><code class="language-${label}">${escapeCode(code)}</code></pre></div>`
}

// Redcarpet starts every block with "\n" unless its output buffer is still
// empty. Blocks here always prepend it; each buffer drops its first one.
function blockBuffer(html: string) {
  return html.startsWith('\n') ? html.slice(1) : html
}

// :hard_wrap rewrites every newline of a rendered paragraph as a line break,
// except a trailing one; explicit "  \n" breaks therefore render twice.
function hardWrap(html: string) {
  const body = html.endsWith('\n') ? html.slice(0, -1) : html
  return body.split('\n').join('<br>\n')
}

// Redcarpet's first pass expands tabs to 4-column stops.
function expandTabs(markdown: string) {
  return markdown
    .split('\n')
    .map((line) => {
      let column = 0
      let expanded = ''
      for (const character of line) {
        if (character !== '\t') {
          expanded += character
          column += 1
          continue
        }
        do {
          expanded += ' '
          column += 1
        } while (column % 4 !== 0)
      }
      return expanded
    })
    .join('\n')
}

function alignmentStyle(align: Tokens.TableCell['align']) {
  return align ? ` style="text-align: ${align}"` : ''
}

const redcarpetRenderer: RendererObject = {
  space() {
    return ''
  },
  // Redcarpet hands block_code the fence body with its trailing newline.
  code({ text, lang }) {
    const language = (lang ?? '').match(/^\S+/)?.[0] ?? 'plaintext'
    return codeBlock(text === '' ? '' : `${text}\n`, language)
  },
  blockquote({ tokens }) {
    return `\n<blockquote>\n${blockBuffer(this.parser.parse(tokens))}</blockquote>\n`
  },
  html({ text, block }) {
    if (!block) return text
    const trimmed = text.replace(/^\n+/, '').replace(/\n+$/, '')
    return trimmed === '' ? '' : `\n${trimmed}\n`
  },
  heading({ tokens, depth }) {
    return `\n<h${depth}>${this.parser.parseInline(tokens)}</h${depth}>\n`
  },
  hr() {
    return '\n<hr>\n'
  },
  list(token) {
    const tag = token.ordered ? 'ol' : 'ul'
    const items = token.items.map((item) => this.listitem(item)).join('')
    return `\n<${tag}>\n${items}</${tag}>\n`
  },
  // Tight items keep the newline that ends their inline text, as Redcarpet does.
  listitem(item) {
    const parts = item.tokens.map((token) => `${this.parser.parse([token])}${token.type === 'text' ? '\n' : ''}`)
    const body = blockBuffer(parts.join('')).replace(/\n+$/, '')
    return `<li>${body}</li>\n`
  },
  // Redcarpet has no task lists: "[ ]" stays literal text.
  checkbox({ raw }) {
    return raw
  },
  // Redcarpet drops the indentation of a paragraph's first line only.
  paragraph({ tokens }) {
    const inline = this.parser.parseInline(tokens).replace(/^ +/, '')
    return `\n<p>${hardWrap(inline)}</p>\n`
  },
  table(token) {
    const header = this.tablerow({ text: token.header.map((cell) => this.tablecell(cell)).join('') })
    const body = token.rows.map((row) => this.tablerow({ text: row.map((cell) => this.tablecell(cell)).join('') })).join('')
    return `\n<table><thead>\n${header}</thead><tbody>\n${body}</tbody></table>\n`
  },
  tablerow({ text }) {
    return `<tr>\n${text}</tr>\n`
  },
  tablecell(token) {
    const tag = token.header ? 'th' : 'td'
    return `<${tag}${alignmentStyle(token.align)}>${this.parser.parseInline(token.tokens)}</${tag}>\n`
  },
  // Only "  \n" is a line break in Redcarpet; a backslash before the newline
  // stays literal and the newline is left for :hard_wrap.
  br({ raw }) {
    return raw.startsWith('\\') ? '\\\n' : '<br>\n'
  },
  // "***x***" nests as <strong><em> in Redcarpet.
  em({ tokens }) {
    const [onlyToken] = tokens
    if (tokens.length === 1 && onlyToken?.type === 'strong' && onlyToken.tokens) {
      return `<strong><em>${this.parser.parseInline(onlyToken.tokens)}</em></strong>`
    }
    return `<em>${this.parser.parseInline(tokens)}</em>`
  },
}

// :no_intra_emphasis: a delimiter run right after an ASCII letter or digit
// never opens emphasis or strikethrough, and a single-delimiter emphasis can't
// close right before one.
const INTRA_WORD = /^[A-Za-z0-9]$/

const redcarpetTokenizer: TokenizerObject = {
  emStrong(src, maskedSrc, prevChar = '') {
    if (INTRA_WORD.test(prevChar)) return undefined
    const token = Tokenizer.prototype.emStrong.call(this, src, maskedSrc, prevChar)
    if (token?.type === 'em' && INTRA_WORD.test(src.charAt(token.raw.length))) return undefined
    return token
  },
  // Strikethrough needs "~~"; a lone "~" stays text.
  del(src, maskedSrc, prevChar = '') {
    if (!src.startsWith('~~') || INTRA_WORD.test(prevChar)) return undefined
    return false
  },
}

const markdown = new Marked({
  gfm: true,
  renderer: redcarpetRenderer,
  tokenizer: redcarpetTokenizer,
  hooks: { preprocess: expandTabs },
})

// ReviewTasksHelper#render_markdown
export function renderMarkdown(text: string | null | undefined) {
  if (isBlank(text)) return ''
  return blockBuffer(markdown.parse(text, { async: false }))
}

// ReviewTasksHelper#render_code_block. `language ||= detect_language(code)`:
// an empty string is truthy in Ruby, so only null/undefined trigger detection.
export function renderCodeBlock(code: string | null | undefined, language: string | null = null) {
  if (isBlank(code)) return ''
  return codeBlock(code, language ?? detectLanguage(code))
}

// Ruby's trailing python branch (`def ` and `:`) is unreachable after the ruby check.
function detectLanguage(code: string) {
  if (code.includes('def ') || code.includes('class ')) return 'ruby'
  if (code.includes('const ') || code.includes('function ')) return 'javascript'
  if (code.includes(': string') || code.includes(': number')) return 'typescript'
  return 'plaintext'
}
