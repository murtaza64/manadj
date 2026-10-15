// Android visualizer embed (#394): one classic IIFE script for a file:// WebView
// (module scripts are CORS-blocked there). Output goes straight into the app's assets.
//   npx vite build -c vite.viz-embed.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    outDir: '../android/app/src/main/assets/viz',
    emptyOutDir: false,
    target: 'es2019',
    lib: { entry: 'src/vizEmbed/main.ts', name: 'manadjVizEmbed', formats: ['iife'], fileName: () => 'viz.js' },
  },
})
