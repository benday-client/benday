import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './appStyles'
import App from './App'
import { purgeRetiredDrafts } from './lib/drafts'

// retired compose surfaces leave records no composer can reopen
purgeRetiredDrafts()

const root = document.getElementById('root')
if (!root) throw new Error('benday: missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
