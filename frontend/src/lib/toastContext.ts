import { createContext, useContext } from 'react'

export type ToastType = 'success' | 'error' | 'info'

export type PushToastOptions = {
  key?: string
  title?: string
  onClick?: () => void
}

type ToastContextValue = {
  pushToast: (message: string, type?: ToastType, options?: PushToastOptions) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToasts() {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToasts must be used within ToastProvider')
  }

  return context
}
