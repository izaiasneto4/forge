// Server-rendered markdown passes raw HTML from AI output through (Redcarpet
// parity), so everything is filtered here before it reaches dangerouslySetInnerHTML.
// Allowlist: the tags markdown and the code-block wrapper produce. Unknown tags
// are unwrapped (their text survives); script-like ones are dropped with their content.

const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'button', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

const DROPPED_TAGS = new Set([
  'base', 'embed', 'form', 'iframe', 'input', 'link', 'math', 'meta', 'noscript', 'object',
  'script', 'select', 'style', 'svg', 'template', 'textarea',
])

const GLOBAL_ATTRIBUTES = new Set(['class', 'title'])

const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href']),
  img: new Set(['src', 'alt']),
  button: new Set(['type', 'data-copy']),
  ol: new Set(['start']),
  th: new Set(['align']),
  td: new Set(['align']),
}

const URL_ATTRIBUTES = new Set(['href', 'src'])
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto'])

// Browsers ignore control characters and whitespace inside a scheme
// ("java\tscript:"), so those are stripped before reading it.
function withoutControlCharacters(value: string) {
  return [...value].filter((character) => {
    const code = character.charCodeAt(0)
    return code > 0x20 && code !== 0x7f
  }).join('')
}

function isSafeUrl(value: string) {
  const compact = withoutControlCharacters(value).toLowerCase()
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(compact)
  return scheme === null || SAFE_SCHEMES.has(scheme[1] ?? '')
}

function isAllowedAttribute(tag: string, name: string) {
  return GLOBAL_ATTRIBUTES.has(name) || (TAG_ATTRIBUTES[tag]?.has(name) ?? false)
}

function cleanAttributes(element: Element, tag: string) {
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase()
    const unsafeUrl = URL_ATTRIBUTES.has(name) && !isSafeUrl(attribute.value)
    if (!isAllowedAttribute(tag, name) || unsafeUrl) element.removeAttribute(attribute.name)
  }
}

function sanitizeChildren(parent: ParentNode) {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === Node.COMMENT_NODE) {
      node.parentNode?.removeChild(node)
      continue
    }
    if (!(node instanceof Element)) continue

    const tag = node.tagName.toLowerCase()
    if (DROPPED_TAGS.has(tag)) {
      node.remove()
      continue
    }

    sanitizeChildren(node)
    if (ALLOWED_TAGS.has(tag)) cleanAttributes(node, tag)
    else node.replaceWith(...node.childNodes)
  }
}

export function sanitizeHtml(html: string) {
  // Template content is inert: nothing loads or runs while it is parsed and cleaned.
  const template = document.createElement('template')
  template.innerHTML = html
  sanitizeChildren(template.content)
  return template.innerHTML
}
