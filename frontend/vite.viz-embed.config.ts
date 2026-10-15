// Android visualizer embed (#394): one classic IIFE script for a file:// WebView
// (module scripts are CORS-blocked there). Output goes straight into the app's assets.
//   npx vite build -c vite.viz-embed.config.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { PHONE_PRESETS } from './src/vizEmbed/presetList'

const OUT = '../android/app/src/main/assets/viz'

export default defineConfig({
  // presets.json: the Android settings page lists PHONE_PRESETS without loading the page.
  plugins: [{ name: 'phone-presets', closeBundle() { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/presets.json`, JSON.stringify(PHONE_PRESETS.map(([id, name]) => ({ id, name })))) } }],
  publicDir: false,
  build: {
    outDir: OUT,
    emptyOutDir: false,
    target: 'es2019',
    lib: { entry: 'src/vizEmbed/main.ts', name: 'manadjVizEmbed', formats: ['iife'], fileName: () => 'viz.js' },
  },
})
