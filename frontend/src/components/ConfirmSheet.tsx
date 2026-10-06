import { useEffect, useRef } from 'react'

import { Icon } from './Icon'

type ConfirmSheetProps = {
  title: string
  message: string
  confirmLabel: string
  onResolve: (confirmed: boolean) => void
}

export function ConfirmSheet({ title, message, confirmLabel, onResolve }: ConfirmSheetProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onResolve(false)
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onResolve])

  return (
    <>
      <div className="scrim" onClick={() => onResolve(false)} />
      <div className="alert" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-message">
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
