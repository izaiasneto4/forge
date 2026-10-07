import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import { ToastProvider } from './lib/toasts'
import { Workspace } from './workspace/Workspace'
import { WorkspaceProvider } from './workspace/WorkspaceProvider'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1 },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <WorkspaceProvider>
            <Workspace />
          </WorkspaceProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
