import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()], publicDir: fileURLToPath(new URL('../../public', import.meta.url)), build: { outDir: process.env.MANADJ_REVIEW_EXPORT_OUT || '/tmp/opencode/manadj-export-inspector-426-dist', emptyOutDir: true } });
