import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode single` produces one self-contained HTML file (scripts and styles inlined)
// that writers can double-click to run offline; see scripts/package-single.mjs.
// Relative asset paths let the same build run at any URL path, e.g. GitHub Pages' /<repo>/.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  resolve: {
    alias: [
      { find: '@pipeline-worker', replacement: fileURLToPath(new URL(mode === 'single' ? './src/ui/worker/inline.ts' : './src/ui/worker/file.ts', import.meta.url)) },
      // One file holds everything offline, so share the compiler build's engine instead of a second copy.
      ...(mode === 'single' ? [{ find: /^inkjs$/, replacement: 'inkjs/full' }] : []),
    ],
  },
  build: {
    chunkSizeWarningLimit: 1500,
    ...(mode === 'single' ? { outDir: 'release/.build', emptyOutDir: true } : {}),
  },
  test: { include: ['tests/**/*.test.ts'] },
}) as never);
