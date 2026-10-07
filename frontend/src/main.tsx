import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/forge.css'
import App from './App'
import { applyAccent, storedAccent } from './lib/preferences'

applyAccent(storedAccent())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
