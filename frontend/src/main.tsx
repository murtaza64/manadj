import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installPerfHook } from './perfHook.ts'
import { installDeckColorVars } from './theme/deckColors.ts'
import { installRoutineColorVars } from './theme/routineColor.ts'

// Deck colors (CONTEXT.md: Deck color): --deck-a … --deck-d (+ -rgb) come
// from the TS source of truth so canvas and CSS consumers can't drift.
installDeckColorVars()

// The routine accent (gh#170): --routine-accent (+ -rgb, -ink), same
// TS-source-of-truth idiom.
installRoutineColorVars()

// Desktop shell (Electron) detection: gates titlebar CSS (drag region,
// traffic-light inset) in TopBar.css. See desktop/README.md.
const isDesktopShell = navigator.userAgent.includes('Electron')
if (isDesktopShell) {
  document.documentElement.classList.add('desktop-shell')
  installPerfHook()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
