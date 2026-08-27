import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { installPerfHook } from './perfHook.ts'
import { installTheme } from './theme/tokens.ts'
import { hydratePersistedSettings } from './settings/persistedSettings.ts'
import RootErrorBoundary from './components/RootErrorBoundary.tsx'

// Design tokens (DESIGN.md, gh#199): every CSS custom property — neutrals,
// accents, deck colors, hotcue palette, scales — comes from the TS source
// of truth (theme/tokens.ts) so canvas/GL and CSS consumers can't drift.
installTheme()

// Desktop shell (Electron) detection: gates titlebar CSS (drag region,
// traffic-light inset) in TopBar.css. See desktop/README.md.
const isDesktopShell = navigator.userAgent.includes('Electron')
if (isDesktopShell) {
  document.documentElement.classList.add('desktop-shell')
  installPerfHook()
}

// Settings hydrate BEFORE App is imported (settings, #176): module-level
// preference stores read localStorage at import time, so the DB->cache
// hydration must land first. App is therefore imported dynamically.
async function boot() {
  await hydratePersistedSettings()
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* Root error boundary (gh#191): crash panel instead of blank screen. */}
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </StrictMode>,
  )
}

void boot()
