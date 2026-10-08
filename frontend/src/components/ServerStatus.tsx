import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { DesktopBridge } from '@shared/desktop-bridge'

import { desktopBridge } from '../lib/desktop'
import { serverStatusMessage } from '../lib/desktopStatus'

function ServerStatusBanner({ bridge }: { bridge: DesktopBridge }) {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<string | null>(null)

  useEffect(
    () =>
      bridge.onBackendState((state) => {
        setMessage(serverStatusMessage(state))
        // Whatever failed while the server was down gets fetched again.
        if (state.status === 'ready') void queryClient.invalidateQueries()
      }),
    [bridge, queryClient],
  )

  if (!message) return null
  return <div className="server-status" role="status">{message}</div>
}

// Desktop only: the shell restarts a crashed server; say so instead of failing silently.
export function ServerStatus() {
  const bridge = desktopBridge()
  return bridge ? <ServerStatusBanner bridge={bridge} /> : null
}
