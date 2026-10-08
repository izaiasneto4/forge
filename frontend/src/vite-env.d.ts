/// <reference types="vite/client" />

import type { DesktopBridge } from '@shared/desktop-bridge'

declare global {
  interface Window {
    // Set by the desktop shell's preload; absent in a browser.
    ordemDesktop?: DesktopBridge
  }
}
