import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/ordem.css'
import App from './App'
import { applyDesktopPlatform } from './lib/desktop'
import { applyAccent, storedAccent } from './lib/preferences'

applyAccent(storedAccent())
applyDesktopPlatform()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
