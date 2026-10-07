import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useToasts } from './toastContext'
import { ToastProvider } from './toasts'

function Harness({ onPush }: { onPush: (pushToast: ReturnType<typeof useToasts>['pushToast']) => void }) {
  const { pushToast } = useToasts()
  return <button type="button" onClick={() => onPush(pushToast)}>Push</button>
}

function renderWith(onPush: (pushToast: ReturnType<typeof useToasts>['pushToast']) => void) {
  const view = render(
    <ToastProvider>
      <Harness onPush={onPush} />
    </ToastProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Push' }))
  return view
}

describe('ToastProvider', () => {
  afterEach(cleanup)

  it('renders notifications newest first inside a shared stack', async () => {
    const first = 'First notification'
    const second = 'Second notification'
    const { container } = renderWith((pushToast) => {
      pushToast(first, 'success')
      pushToast(second, 'info')
    })

    await screen.findByText(second)

    const stack = container.querySelector('.notif-stack')
    const messages = [...container.querySelectorAll('.notif p')].map((node) => node.textContent)

    expect(stack).not.toBeNull()
    expect(messages).toEqual([second, first])
  })

  it('replaces repeated keyed notifications instead of stacking duplicates', async () => {
    const stale = 'Requested only enabled'
    const fresh = 'All open PRs enabled'
    const { container } = renderWith((pushToast) => {
      pushToast(stale, 'success', { key: 'review-scope' })
      pushToast(fresh, 'success', { key: 'review-scope' })
    })

    await screen.findByText(fresh)

    expect(container.querySelectorAll('.notif')).toHaveLength(1)
    expect(screen.queryByText(stale)).toBeNull()
  })

  it('shows the given title and runs the click action', async () => {
    const title = 'Review finished · #12'
    const message = 'Findings are ready'
    const onClick = vi.fn()

    renderWith((pushToast) => pushToast(message, 'success', { title, onClick }))

    fireEvent.click(await screen.findByText(message))

    expect(screen.getByText(title)).toBeTruthy()
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
