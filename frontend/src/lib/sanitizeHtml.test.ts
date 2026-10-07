import { describe, expect, it } from 'vitest'

import { sanitizeHtml } from './sanitizeHtml'

describe('sanitizeHtml', () => {
  it('keeps the markup markdown and code blocks produce', () => {
    const markdown = '<p>Use <code>create_or_find_by!</code> and <a href="https://example.com/docs">the docs</a>.</p>'
    const codeBlock = '<div class="code-block"><div class="code-head"><span>ruby</span><button type="button" class="copy-btn" data-copy="puts 1">Copy</button></div><pre class="highlight"><code class="language-ruby">puts 1</code></pre></div>'

    expect(sanitizeHtml(markdown)).toBe(markdown)
    expect(sanitizeHtml(codeBlock)).toBe(codeBlock)
  })

  it('drops scripts and other active elements with their content', () => {
    const kept = 'Finding'
    const html = `<p>${kept}</p><script>alert(1)</script><style>body{}</style><iframe src="https://evil.test"></iframe>`

    expect(sanitizeHtml(html)).toBe(`<p>${kept}</p>`)
  })

  it('strips event handlers and attributes outside the allowlist', () => {
    const html = '<img src="https://example.com/a.png" alt="diagram" onerror="alert(1)" style="position:fixed">'

    expect(sanitizeHtml(html)).toBe('<img src="https://example.com/a.png" alt="diagram">')
  })

  it('removes links and images with unsafe schemes, even when obfuscated', () => {
    const unsafe = ['javascript:alert(1)', 'java\tscript:alert(1)', ' JAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>']
    const safe = ['https://example.com', 'mailto:dev@example.com', '/review_tasks/1', '#findings']

    for (const href of unsafe) {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', href)
      anchor.textContent = 'link'
      expect(sanitizeHtml(anchor.outerHTML)).toBe('<a>link</a>')
    }
    for (const href of safe) {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', href)
      expect(sanitizeHtml(anchor.outerHTML)).toBe(anchor.outerHTML)
    }
  })

  it('unwraps unknown tags so their text survives and removes comments', () => {
    const text = 'still readable'

    expect(sanitizeHtml(`<details><summary>${text}</summary></details><!-- hidden -->`)).toBe(text)
  })
})
