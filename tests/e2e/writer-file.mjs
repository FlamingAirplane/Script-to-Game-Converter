// End-to-end check of the writer edition opened straight from disk (file://), in WebKit (Safari's
// engine) and Chromium. Run with `npm run test:e2e` (builds the file first).
// One-time setup: npx playwright-core install webkit chromium
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright-core';

const file = fileURLToPath(new URL('../../release/Narrative-Bridge.html', import.meta.url));
if (!existsSync(file)) {
  console.error('release/Narrative-Bridge.html not found. Run: npm run build:single');
  process.exit(1);
}
const url = `file://${encodeURI(file)}`;
let failed = 0;

for (const [name, type] of [['WebKit', webkit], ['Chromium', chromium]]) {
  let browser;
  try {
    browser = await type.launch();
  } catch (e) {
    console.error(`${name}: could not launch (${e.message.split('\n')[0]}). Run: npx playwright-core install webkit chromium`);
    failed++;
    continue;
  }
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const step = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      throw new Error(`${label}: ${e.message.split('\n')[0]}`);
    }
  };
  try {
    await step('opens with the welcome guide', async () => {
      await page.goto(url);
      await page.getByText('New here? Four steps.').waitFor({ timeout: 10000 });
    });
    await step('theme toggle switches to dark and survives a reload', async () => {
      const paper = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim());
      const light = await paper();
      await page.getByRole('button', { name: /Theme:/ }).click(); // auto → light
      await page.getByRole('button', { name: /Theme:/ }).click(); // light → dark
      if ((await paper()) === light) throw new Error('dark theme did not apply');
      await page.reload();
      await page.getByRole('button', { name: 'Theme: dark' }).waitFor({ timeout: 5000 });
      if ((await paper()) === light) throw new Error('dark theme was not remembered');
      await page.getByRole('button', { name: /Theme:/ }).click(); // dark → auto (system light in tests)
    });
    await step('converts a sample', async () => {
      await page.getByText('The Locked Archive').first().click();
      await page.getByRole('button', { name: /Archive Entrance/ }).waitFor();
    });
    await step('playtest: toggling an item unlocks its choice immediately', async () => {
      await page.getByRole('button', { name: /Playtest/ }).click();
      const open = page.getByRole('button', { name: 'Open the archive' });
      if (await open.count()) throw new Error('locked choice visible before the key');
      await page.locator('.vars li', { hasText: 'has_archive_key' }).locator('input').check();
      await open.waitFor({ timeout: 3000 });
    });
    await step('playtest: choices advance the story', async () => {
      await page.getByRole('button', { name: 'Search the reading room' }).click();
      await page.getByRole('button', { name: 'Return to the entrance' }).waitFor();
    });
    let zipBytes = 0;
    await step('exports a verified Unity package', async () => {
      await page.getByRole('button', { name: /Export/ }).click();
      await page.getByRole('button', { name: 'Build Unity package' }).click();
      await page.getByText('package verified').waitFor({ timeout: 15000 });
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .zip' }).click()]);
      const buf = readFileSync(await dl.path());
      if (buf.subarray(0, 2).toString() !== 'PK') throw new Error('download is not a zip');
      zipBytes = buf.length;
    });
    await step('playable story: downloads, plays, resumes after reload, undoes, ends', async () => {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download playable story/ }).click()]);
      // Keep the real .html name: without an extension the browser would show the page as plain text.
      const path = join(mkdtempSync(join(tmpdir(), 'nb-e2e-')), dl.suggestedFilename());
      await dl.saveAs(path);
      const reader = await browser.newPage();
      reader.on('pageerror', (e) => errors.push(`reader: ${e.message}`));
      await reader.goto(`file://${encodeURI(path)}`);
      await reader.getByRole('heading', { name: 'The Locked Archive' }).waitFor();
      await reader.getByRole('button', { name: 'Begin' }).click();
      await reader.getByText('The archive is locked.').waitFor();
      await reader.getByRole('button', { name: 'Search the reading room' }).click();
      await reader.getByRole('button', { name: 'Lift the loose floorboard' }).waitFor();
      await reader.reload();
      await reader.getByRole('button', { name: 'Continue reading' }).click();
      await reader.getByRole('button', { name: 'Lift the loose floorboard' }).waitFor();
      await reader.getByRole('button', { name: 'Undo' }).click();
      await reader.getByRole('button', { name: 'Leave' }).click();
      await reader.getByText('❦ The End ❦').waitFor();
      await reader.close();
    });
    await step('restores the project after a reload', async () => {
      await page.reload();
      await page.getByRole('button', { name: /Archive Entrance/ }).waitFor({ timeout: 5000 });
    });
    await step('imports a Final Draft (.fdx) file through the file picker', async () => {
      await page.getByRole('button', { name: /Import/ }).first().click();
      await page.locator('.dropzone input[type=file]').setInputFiles(fileURLToPath(new URL('../fixtures/archive.fdx', import.meta.url)));
      await page.getByText('archive.fdx').waitFor({ timeout: 5000 });
      await page.getByRole('button', { name: /^Convert/ }).click();
      await page.locator('.passage-item', { hasText: 'Cliff Path' }).waitFor({ timeout: 5000 });
    });
    if (errors.length) throw new Error(`console errors: ${errors.join(' | ')}`);
    console.log(`✓ ${name}: all checks passed (zip ${(zipBytes / 1024).toFixed(1)} KB)`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}: ${e.message}`);
  } finally {
    await browser.close();
  }
}
process.exit(failed ? 1 : 0);
