import react from '@vitejs/plugin-react';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { offlineSite } from './scripts/offline-site';

// `vite build --mode single` produces one self-contained HTML file (scripts and styles inlined)
// that writers can double-click to run offline; see scripts/package-single.mjs.
// Relative asset paths let the same build run at any URL path, e.g. GitHub Pages' /<repo>/.
// The admin design editor's password (#admin). Set NB_ADMIN_PASSWORD in the environment (a GitHub
// Actions secret for the website) or in .env.local (never committed). Only a salted PBKDF2 hash is
// built in; see src/ui/admin/lock.ts. With no password, the editor can't be opened on a built site.
function adminLock(mode: string) {
  const password = process.env.NB_ADMIN_PASSWORD ?? loadEnv(mode, process.cwd(), 'NB_').NB_ADMIN_PASSWORD;
  if (!password) return null;
  const iterations = 600_000;
  const salt = randomBytes(16);
  return { salt: salt.toString('base64'), hash: pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64'), iterations };
}

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __NB_ADMIN_LOCK__: JSON.stringify(mode === 'test' ? null : adminLock(mode)) },
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react(), offlineSite()],
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
