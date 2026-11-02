import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
// Default stays local to this checkout. Publishing and independent QA must
// choose their own explicit --outDir or MANADJ_REVIEW_FIELDS_OUT directory.
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()], build: { outDir: process.env.MANADJ_REVIEW_FIELDS_OUT || './dist', emptyOutDir: true } });
