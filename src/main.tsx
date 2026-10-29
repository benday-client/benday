import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/cards.css'
import './styles/dialogs.css'
import './styles/views.css'
import './styles/dither.css'

const root = document.getElementById('root')
if (!root) throw new Error('benday: missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
