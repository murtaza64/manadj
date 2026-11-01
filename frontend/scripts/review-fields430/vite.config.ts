import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()], build: { outDir: '/tmp/opencode/manadj-fields430-dist', emptyOutDir: true } });
