import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'

type ToastType = 'success' | 'error' | 'info'

type Toast = {
  id: number
  key?: string
  message: string
  type: ToastType
}

type PushToastOptions = {
  key?: string
}

type ToastContextValue = {
  pushToast: (message: string, type?: ToastType, options?: PushToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timeoutIds = useRef(new Map<number, number>())

  const dismissToast = useCallback((id: number) => {
    const timeoutId = timeoutIds.current.get(id)
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      timeoutIds.current.delete(id)
    }

    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const scheduleDismiss = useCallback((id: number) => {
    const existingTimeoutId = timeoutIds.current.get(id)
    if (existingTimeoutId) {
      window.clearTimeout(existingTimeoutId)
    }

    const timeoutId = window.setTimeout(() => {
      timeoutIds.current.delete(id)
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 5000)

    timeoutIds.current.set(id, timeoutId)
  }, [])

  const pushToast = useCallback((message: string, type: ToastType = 'info', options?: PushToastOptions) => {
    let toastId: number | null = null

    setToasts((current) => {
      const existing = options?.key ? current.find((toast) => toast.key === options.key) : undefined
      const id = existing?.id ?? (Date.now() + Math.round(Math.random() * 1000))

      toastId = id

      if (existing) {
        return current.map((toast) => (
          toast.id === id
            ? { ...toast, message, type }
            : toast
        ))
      }

      return [ ...current, { id, key: options?.key, message, type } ]
    })

    if (toastId !== null) {
      scheduleDismiss(toastId)
    }
  }, [scheduleDismiss])

  const value = useMemo(() => ({ pushToast }), [pushToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="global-toast-stack flex max-w-sm flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`global-toast global-toast--show global-toast--${toast.type}`}
          >
            <div className="flex items-center gap-2">
              <span className="flex-1">{toast.message}</span>
              <button type="button" onClick={() => dismissToast(toast.id)}>
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToasts() {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToasts must be used within ToastProvider')
  }

  return context
}
