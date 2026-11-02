import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode single` produces one self-contained HTML file (scripts and styles inlined)
// that writers can double-click to run offline; see scripts/package-single.mjs.
// Relative asset paths let the same build run at any URL path, e.g. GitHub Pages' /<repo>/.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  build: {
    chunkSizeWarningLimit: 1500,
    ...(mode === 'single' ? { outDir: 'release/.build', emptyOutDir: true } : {}),
  },
  test: { include: ['tests/**/*.test.ts'] },
}) as never);
