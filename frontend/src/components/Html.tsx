import type { MouseEvent } from 'react'

const COPIED_RESET_MS = 1200

// Code blocks come pre-rendered from the server with a .copy-btn carrying the raw code.
function copyCodeBlock(event: MouseEvent<HTMLDivElement>) {
  if (!(event.target instanceof Element)) return
  const button = event.target.closest('.copy-btn')
  if (!(button instanceof HTMLButtonElement) || button.dataset.copy === undefined) return
  event.stopPropagation()
  const showLabel = (label: string) => {
    button.textContent = label
    window.setTimeout(() => { button.textContent = 'Copy' }, COPIED_RESET_MS)
  }
  void navigator.clipboard?.writeText(button.dataset.copy).then(() => showLabel('Copied'), () => showLabel('Copy failed'))
}

export function Html({ html, className = 'md' }: { html: string | null; className?: string }) {
  if (!html) return null
  return <div className={className} onClick={copyCodeBlock} dangerouslySetInnerHTML={{ __html: html }} />
}
