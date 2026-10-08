import type { DesktopUpdateState } from '@shared/desktop-bridge'

// What Settings > About says for each updater state.
export function updateSummary(state: DesktopUpdateState): { label: string; hint?: string } {
  switch (state.status) {
    case 'disabled':
      return { label: 'Automatic updates are off', hint: 'Development builds and unsigned macOS builds do not update themselves.' }
    case 'idle':
      return { label: 'Ordem is up to date' }
    case 'checking':
      return { label: 'Checking for updates…' }
    case 'available':
      return { label: `Version ${state.availableVersion ?? ''} is available` }
    case 'downloading':
      return { label: `Downloading version ${state.availableVersion ?? ''}…`, hint: state.downloadPercent === null ? undefined : `${state.downloadPercent}%` }
    case 'ready':
      return { label: `Version ${state.availableVersion ?? ''} is ready to install`, hint: 'Ordem restarts to finish. Running reviews stop and resume on their own.' }
    case 'error':
      return { label: 'Could not check for updates', hint: state.error ?? undefined }
  }
}
