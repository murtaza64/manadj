import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { installPerfHook } from './perfHook.ts'
import { FONT_MONO, installTheme } from './theme/tokens.ts'
import { DEV_SURFACES } from './devMode.ts'
import { isMac } from './utils/platform.ts'
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
  // Windows/Linux caption buttons sit on the right, not traffic lights (gh#313).
  if (!isMac()) document.documentElement.classList.add('platform-other')
  // Perf hook is a dev surface (packaged-app #278): dev shells only.
  if (DEV_SURFACES) installPerfHook()
}

// Settings hydrate BEFORE App is imported (settings, #176): module-level
// preference stores read localStorage at import time, so the DB->cache
// hydration must land first. App is therefore imported dynamically.
// App font (gh#312): canvas text doesn't trigger @font-face loads, so load
// the faces before first render (capped, falls back to monospace on timeout).
function loadAppFont(): Promise<unknown> {
  if (!document.fonts) return Promise.resolve()
  const faces = ['400', '700'].map(weight => document.fonts.load(`${weight} 16px ${FONT_MONO}`))
  return Promise.race([Promise.allSettled(faces), new Promise(resolve => setTimeout(resolve, 1500))])
}

async function boot() {
  await Promise.all([hydratePersistedSettings(), loadAppFont()])
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
