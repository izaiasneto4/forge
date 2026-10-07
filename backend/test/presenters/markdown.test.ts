import { describe, expect, test } from 'bun:test'
import { htmlEscape, renderCodeBlock, renderMarkdown } from '../../src/presenters/markdown'
import redcarpetCases from './fixtures/redcarpet.json'

// fixtures/redcarpet.json holds `ApplicationController.helpers.render_markdown`
// and `render_code_block` output captured from the Rails app (Redcarpet 3.6,
// Rouge 4.7), with Rouge's token <span>s stripped from code blocks.

describe('renderMarkdown', () => {
  test.each(['', null, undefined, '   \n'])('returns an empty string for blank input %p', (blank) => {
    expect(renderMarkdown(blank)).toBe('')
  })

  test('renders bold text', () => {
    const word = 'bold'

    expect(renderMarkdown(`**${word}**`)).toContain(`<strong>${word}</strong>`)
  })

  test('renders fenced code blocks inside the copyable code-block wrapper', () => {
    const language = 'ruby'
    const code = 'def foo\nend'

    const html = renderMarkdown(`\`\`\`${language}\n${code}\n\`\`\``)

    expect(html).toContain('<div class="code-block relative group my-4">')
    expect(html).toContain(`<span class="text-gray-400 text-xs font-mono">${language}</span>`)
    expect(html).toContain(`data-copy-content-value="${htmlEscape(`${code}\n`)}"`)
    expect(html).toContain(`<code class="language-${language}">${code}\n</code>`)
  })

  test('labels fences without a language as plaintext', () => {
    const plaintext = 'plaintext'

    expect(renderMarkdown('```\nplain\n```')).toContain(`<code class="language-${plaintext}">`)
  })

  test('escapes code like Rouge (&, <, >) and the copy value like ERB', () => {
    const code = `a < b && "c" && 'd'`

    const html = renderMarkdown(`\`\`\`js\n${code}\n\`\`\``)

    expect(html).toContain(`<code class="language-js">a &lt; b &amp;&amp; "c" &amp;&amp; 'd'\n</code>`)
    expect(html).toContain(`data-copy-content-value="${htmlEscape(`${code}\n`)}"`)
  })

  test('renders tables', () => {
    expect(renderMarkdown('| header |\n|--------|\n| cell   |')).toContain('<table')
  })

  test('autolinks bare URLs', () => {
    const url = 'https://example.com'

    expect(renderMarkdown(url)).toContain(`<a href="${url}">${url}</a>`)
  })

  test('hard-wraps single newlines inside paragraphs', () => {
    const [first, second] = ['Line one', 'Line two']

    expect(renderMarkdown(`${first}\n${second}`)).toContain(`${first}<br>\n${second}`)
  })

  test('does not emphasize inside words', () => {
    const snakeCase = 'foo_bar_baz and a*b*c'

    expect(renderMarkdown(snakeCase)).toContain(snakeCase)
  })

  test('passes raw HTML through, as Redcarpet does without :escape_html', () => {
    const rawHtml = '<script>alert(1)</script>'

    expect(renderMarkdown(rawHtml)).toContain(rawHtml)
  })

  const markdownCases = redcarpetCases.filter((entry) => entry.helper === 'render_markdown')
  test.each(markdownCases.map((entry) => [entry.input, entry.html]))('matches Redcarpet for %p', (input, redcarpetHtml) => {
    expect(renderMarkdown(input)).toBe(redcarpetHtml)
  })
})

describe('renderCodeBlock', () => {
  test.each(['', null, undefined])('returns an empty string for blank code %p', (blank) => {
    expect(renderCodeBlock(blank)).toBe('')
  })

  test('labels the block with the given language', () => {
    const language = 'ruby'

    expect(renderCodeBlock('def foo; end', language)).toContain(`<span class="text-gray-400 text-xs font-mono">${language}</span>`)
  })

  test('includes the copy button wiring', () => {
    const html = renderCodeBlock('test code')

    expect(html).toContain('data-controller="copy"')
    expect(html).toContain('data-action="click->copy#copy"')
  })

  test.each([
    ['def call; end', 'ruby'],
    ['class Foo; end', 'ruby'],
    ['const value = 1', 'javascript'],
    ['function go() {}', 'javascript'],
    ['name: string', 'typescript'],
    ['count: number', 'typescript'],
    ['plain words', 'plaintext'],
  ])('detects the language of %p as %p when none is given', (code, language) => {
    expect(renderCodeBlock(code)).toContain(`<code class="language-${language}">`)
  })

  test('keeps an empty language instead of detecting one, like Ruby `||=`', () => {
    const emptyLanguage = ''

    expect(renderCodeBlock('def foo; end', emptyLanguage)).toContain(`<code class="language-${emptyLanguage}">`)
  })

  const codeBlockCases = redcarpetCases.filter((entry) => entry.helper === 'render_code_block')
  test.each(codeBlockCases.map((entry) => [entry.input, entry.language ?? null, entry.html]))(
    'matches the Rails helper for %p',
    (input, language, railsHtml) => {
      expect(renderCodeBlock(input, language)).toBe(railsHtml)
    },
  )
})
