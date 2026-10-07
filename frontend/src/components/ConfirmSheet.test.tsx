import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmSheet } from './ConfirmSheet'

const confirmLabel = 'Delete'

function renderSheet(onResolve = vi.fn()) {
  return render(<ConfirmSheet title="Delete #12 from Ordem?" message="Nothing changes on GitHub." confirmLabel={confirmLabel} onResolve={onResolve} />)
}

describe('ConfirmSheet', () => {
  afterEach(cleanup)

  it('is a modal alert dialog that starts on the confirm button', () => {
    renderSheet()

    expect(screen.getByRole('alertdialog').getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: confirmLabel }))
  })

  it('keeps Tab on the dialog buttons', () => {
    renderSheet()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: confirmLabel })

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(cancel)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm)
  })

  it('returns focus to the element that opened it', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    const { unmount } = renderSheet()
    unmount()

    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('cancels on Escape', () => {
    const onResolve = vi.fn()
    renderSheet(onResolve)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onResolve).toHaveBeenCalledWith(false)
  })
})
