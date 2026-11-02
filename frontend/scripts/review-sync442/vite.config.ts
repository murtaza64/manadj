import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: __dirname, publicDir: '../../public', plugins: [react()],
  build: { outDir: process.env.MANADJ_REVIEW_SYNC_OUT || './dist', emptyOutDir: true } });
