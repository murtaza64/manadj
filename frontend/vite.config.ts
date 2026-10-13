import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The app version is single-sourced from pyproject.toml (#298); release.py
// bumps it there and mirrors it into desktop/package.json.
// MANADJ_APP_VERSION overrides it for prerelease builds (build_dmg.py).
function appVersion(): string {
  if (process.env.MANADJ_APP_VERSION) return process.env.MANADJ_APP_VERSION
  const pyproject = readFileSync(new URL('../pyproject.toml', import.meta.url), 'utf8')
  const match = pyproject.match(/^version\s*=\s*"([^"]+)"/m)
  return match ? match[1] : '0.0.0'
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  test: { setupFiles: ['./src/test/setup.ts'] },
})
