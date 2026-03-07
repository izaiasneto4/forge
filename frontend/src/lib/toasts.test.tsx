import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ToastProvider, useToasts } from './toasts'

function ToastHarness() {
  const { pushToast } = useToasts()

  return (
    <button
      type="button"
      onClick={() => {
        pushToast('First toast', 'success')
        pushToast('Second toast', 'info')
      }}
    >
      Push toasts
    </button>
  )
}

describe('ToastProvider', () => {
  it('renders multiple toasts inside a shared stack container', async () => {
    const { container } = render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    )

    screen.getByRole('button', { name: 'Push toasts' }).click()

    const stack = container.querySelector('.global-toast-stack')
    const toasts = container.querySelectorAll('.global-toast')

    expect(stack).not.toBeNull()
    expect(toasts).toHaveLength(2)
    expect([...toasts].every((toast) => toast.parentElement === stack)).toBe(true)
    expect(screen.getByText('First toast')).toBeTruthy()
    expect(screen.getByText('Second toast')).toBeTruthy()
  })
})
