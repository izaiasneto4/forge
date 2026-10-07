import { useEffect, useEffectEvent, useRef } from 'react'

import { Icon } from './Icon'

type ConfirmSheetProps = {
  title: string
  message: string
  confirmLabel: string
  onResolve: (confirmed: boolean) => void
}

export function ConfirmSheet({ title, message, confirmLabel, onResolve }: ConfirmSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const resolve = useEffectEvent((confirmed: boolean) => onResolve(confirmed))

  // Modal: Tab stays on the dialog's buttons so nothing behind the scrim can be
  // triggered while a destructive action waits, and focus returns to the opener.
  const keepFocusInside = useEffectEvent((event: KeyboardEvent) => {
    const buttons = [...(dialogRef.current?.querySelectorAll('button') ?? [])]
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (!first || !last) return

    const active = document.activeElement
    const outside = !(active instanceof Node) || !dialogRef.current?.contains(active)
    if (outside || (event.shiftKey && active === first)) {
      const target = event.shiftKey ? last : first
      event.preventDefault()
      target.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  })

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    confirmRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        resolve(false)
      } else if (event.key === 'Tab') {
        keepFocusInside(event)
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      opener?.focus()
    }
  }, [])

  return (
    <>
      <div className="scrim" onClick={() => onResolve(false)} />
      <div ref={dialogRef} className="alert" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <div className="alert-icon"><Icon name="flame" size={26} stroke={1.8} /></div>
        <h3 id="confirm-title">{title}</h3>
        <p id="confirm-message">{message}</p>
        <div className="alert-actions">
          <button type="button" className="btn" onClick={() => onResolve(false)}>Cancel</button>
          <button ref={confirmRef} type="button" className="btn primary" onClick={() => onResolve(true)}>{confirmLabel}</button>
        </div>
      </div>
    </>
  )
}
