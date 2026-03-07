import { createConsumer } from '@rails/actioncable'

type SubscriptionCallbacks = {
  connected?: () => void
  disconnected?: () => void
  received?: (data: unknown) => void
}

let consumer: ReturnType<typeof createConsumer> | null = null

function cableUrl() {
  if (import.meta.env.VITE_CABLE_URL) {
    return import.meta.env.VITE_CABLE_URL
  }

  if (typeof window === 'undefined') {
    return 'ws://localhost:3000/cable'
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/cable`
}

function getConsumer() {
  if (!consumer) {
    consumer = createConsumer(cableUrl())
  }

  return consumer
}

export function subscribe(
  params: Record<string, unknown>,
  callbacks: SubscriptionCallbacks,
) {
  const subscription = getConsumer().subscriptions.create(params, callbacks)

  return () => {
    subscription.unsubscribe()
  }
}
