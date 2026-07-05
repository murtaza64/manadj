import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installDeckColorVars } from './theme/deckColors.ts'

// Deck colors (CONTEXT.md: Deck color): --deck-a/--deck-b (+ -rgb) come
// from the TS source of truth so canvas and CSS consumers can't drift.
installDeckColorVars()

// Desktop shell (Electron) detection: gates titlebar CSS (drag region,
// traffic-light inset) in TopBar.css. See desktop/README.md.
if (navigator.userAgent.includes('Electron')) {
  document.documentElement.classList.add('desktop-shell')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
