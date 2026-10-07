import { useCallback, useMemo, useRef, useState, type PropsWithChildren } from 'react'

import { Icon } from '../components/Icon'
import { ToastContext, type PushToastOptions, type ToastType } from './toastContext'

type Toast = {
  id: number
  key?: string
  title?: string
  message: string
  type: ToastType
  leaving: boolean
  onClick?: () => void
}

const VISIBLE_MS = 5500
const LEAVE_MS = 280

const DEFAULT_TITLES: Record<ToastType, string> = {
  success: 'Done',
  error: 'Something went wrong',
  info: 'Ordem',
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timeoutIds = useRef(new Map<number, number>())
  const nextId = useRef(1)
  const keyIds = useRef(new Map<string, number>())

  const remove = useCallback((id: number) => {
    for (const [key, keyId] of keyIds.current) {
      if (keyId === id) keyIds.current.delete(key)
    }
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)))
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, LEAVE_MS)
  }, [])

  const scheduleDismiss = useCallback((id: number) => {
    const existing = timeoutIds.current.get(id)
    if (existing) window.clearTimeout(existing)

    const timeoutId = window.setTimeout(() => {
      timeoutIds.current.delete(id)
      remove(id)
    }, VISIBLE_MS)

    timeoutIds.current.set(id, timeoutId)
  }, [remove])

  const dismiss = useCallback((id: number) => {
    const existing = timeoutIds.current.get(id)
    if (existing) window.clearTimeout(existing)
    timeoutIds.current.delete(id)
    remove(id)
  }, [remove])

  const pushToast = useCallback((message: string, type: ToastType = 'info', options?: PushToastOptions) => {
    const key = options?.key
    const id = (key ? keyIds.current.get(key) : undefined) ?? nextId.current++
    if (key) keyIds.current.set(key, id)

    setToasts((current) => {
      const next = { key, title: options?.title, message, type, onClick: options?.onClick, leaving: false }

      if (current.some((toast) => toast.id === id)) {
        return current.map((toast) => (toast.id === id ? { ...toast, ...next } : toast))
      }

      return [{ id, ...next }, ...current].slice(0, 4)
    })

    scheduleDismiss(id)
  }, [scheduleDismiss])

  const value = useMemo(() => ({ pushToast }), [pushToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="notif-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`notif notif--${toast.type}${toast.leaving ? ' out' : ''}${toast.onClick ? ' clickable' : ''}`}
            onClick={() => {
              if (!toast.onClick) return
              toast.onClick()
              dismiss(toast.id)
            }}
          >
            <div className="app">
              <Icon name={toast.type === 'error' ? 'warn' : 'flame'} size={20} stroke={1.8} />
            </div>
            <div className="notif-body">
              <div className="h"><b>{toast.title ?? DEFAULT_TITLES[toast.type]}</b><span>now</span></div>
              <p>{toast.message}</p>
            </div>
            <button
              type="button"
              className="notif-close"
              aria-label="Dismiss"
              onClick={(event) => {
                event.stopPropagation()
                dismiss(toast.id)
              }}
            >
              <Icon name="x" size={11} stroke={2.4} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
