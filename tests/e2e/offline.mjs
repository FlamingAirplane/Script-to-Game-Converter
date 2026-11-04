// End-to-end check of the website's offline copy (scripts/offline-site.ts) in Chromium: after one
// visit the app opens, converts, plays and exports with no connection, and a new deploy offers a
// reload. Run with `npm run test:offline` (builds the site first).
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
if (!existsSync(join(dist, 'sw.js'))) {
  console.error('dist/sw.js not found. Run: npm run build');
  process.exit(1);
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
// Serves dist/ under /app/ like GitHub Pages serves /<repo>/. `deploy` simulates a new release.
let deploy = 0;
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/app\//, '');
  const file = normalize(join(dist, path || 'index.html'));
  if (!file.startsWith(dist) || !existsSync(file) || file.endsWith('/')) {
    res.writeHead(404).end();
    return;
  }
  let body = readFileSync(file);
  if (path === 'sw.js' && deploy) body = Buffer.from(body.toString().replace(/narrative-bridge-([0-9a-f]+)/, `narrative-bridge-$1-${deploy}`));
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/app/`;

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true });
// Exports here are checked as downloads; Chromium's Save dialogs would need a person to answer them.
await context.addInitScript(() => {
  for (const k of ['showSaveFilePicker', 'showOpenFilePicker']) Object.defineProperty(window, k, { value: undefined, configurable: true });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = false;
const step = async (label, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    failed = true;
    console.error(`  ✗ ${label}: ${e.message.split('\n')[0]}`);
    throw e;
  }
};
try {
  await step('first visit saves the app for offline use', async () => {
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('narrative-bridge-')));
    const manifest = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href'));
    if (manifest !== 'manifest.webmanifest') throw new Error('no web app manifest');
  });
  await step('opens with no connection', async () => {
    await context.setOffline(true);
    await page.reload();
    await page.getByText('The Locked Archive').first().waitFor({ timeout: 10000 });
  });
  await step('converts, plays and exports offline (background worker and lazy chapters are cached)', async () => {
    await page.getByText('The Locked Archive').first().click();
    await page.getByRole('button', { name: /Archive Entrance/ }).waitFor();
    await page.getByRole('button', { name: /Playtest/ }).click();
    await page.getByRole('button', { name: 'Search the reading room' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /Export/ }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download playable story/ }).click()]);
    if (!dl.suggestedFilename().endsWith('.html')) throw new Error('no playable story download');
  });
  await step('a new deploy offers a reload, which keeps the project', async () => {
    await context.setOffline(false);
    deploy++;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    await page.getByText('A new edition of Narrative Bridge is ready.').waitFor({ timeout: 10000 });
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reload' }).click()]);
    await page.getByRole('button', { name: /Archive Entrance/ }).first().waitFor({ timeout: 10000 });
    const keys = await page.evaluate(() => caches.keys());
    if (keys.length !== 1 || !keys[0].endsWith('-1')) throw new Error(`old caches were not cleaned up: ${keys}`);
  });
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log('✓ Offline copy: all checks passed');
} catch (e) {
  failed = true;
  if (!e.message.startsWith('page errors')) console.error(`✗ Offline copy failed`);
  else console.error(`✗ ${e.message}`);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
