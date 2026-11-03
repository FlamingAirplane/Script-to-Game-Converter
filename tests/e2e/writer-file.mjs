// End-to-end check of the writer edition opened straight from disk (file://), in WebKit (Safari's
// engine) and Chromium. Run with `npm run test:e2e` (builds the file first).
// One-time setup: npx playwright-core install webkit chromium
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
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
    await step('browser shortcuts with extra keys (⌘⇧F, ⌘⇧O…) reach the browser; ⌘F still finds', async () => {
      // Record, after the app's own listener, whether each key press was taken by the app.
      await page.evaluate(() => {
        window.__taken = [];
        window.addEventListener('keydown', (e) => e.key.length === 1 && window.__taken.push(`${e.shiftKey ? 'shift+' : ''}${e.altKey ? 'alt+' : ''}${e.key.toLowerCase()}:${e.defaultPrevented}`));
      });
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      for (const k of ['ControlOrMeta+Shift+f', 'ControlOrMeta+Shift+o', 'ControlOrMeta+Shift+s', 'ControlOrMeta+Alt+f', 'ControlOrMeta+Shift+l']) await page.keyboard.press(k);
      const taken = await page.evaluate(() => window.__taken);
      if (taken.length !== 5 || taken.some((t) => t.endsWith(':true'))) throw new Error(`the app took a browser shortcut: ${taken.join(', ')}`);
      if (await page.locator('details.find-panel[open]').count()) throw new Error('⌘⇧F opened the app’s Find');
      await page.keyboard.press('ControlOrMeta+f');
      await page.locator('details.find-panel[open]').waitFor({ timeout: 3000 });
      await page.locator('details.find-panel summary').click(); // close it again
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
    await step('Twine: story and logic by default, or the story only', async () => {
      await page.getByRole('button', { name: /Export/ }).click();
      const twine = async () => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download for Twine/ }).click()]);
        return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'utf8') };
      };
      const full = await twine();
      if (!/<<if \$has_archive_key>>/.test(full.text) || /<span|"""/.test(full.text)) throw new Error('SugarCube file is missing its logic or still cluttered');
      await page.getByLabel(/Story only/).check();
      const only = await twine();
      if (only.name !== 'the_locked_archive-story-only.twee') throw new Error(`unexpected file name ${only.name}`);
      if (/<<|@@|\$|StoryInit|"format"/.test(only.text) || !only.text.includes('MIRA: The archive is locked.')) throw new Error('story-only file has extras or is missing text');
    });
    await step('restores the project after a reload', async () => {
      await page.reload();
      await page.getByRole('button', { name: /Archive Entrance/ }).waitFor({ timeout: 5000 });
    });
    await step('a reader’s place carries over to a revised edition of the playable story', async () => {
      const exportPlayable = async (path) => {
        await page.getByRole('button', { name: /Export/ }).click();
        const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download playable story/ }).click()]);
        await dl.saveAs(path);
      };
      const path = join(mkdtempSync(join(tmpdir(), 'nb-edition-')), 'archive.html');
      await exportPlayable(path);
      const reader = await browser.newPage();
      reader.on('pageerror', (e) => errors.push(`reader: ${e.message}`));
      await reader.goto(`file://${encodeURI(path)}`);
      await reader.getByRole('button', { name: 'Begin' }).click();
      await reader.getByRole('button', { name: 'Search the reading room' }).click();
      await reader.getByRole('button', { name: 'Lift the loose floorboard' }).waitFor();
      // Revise the story: the reader's next visit opens the new edition.
      await page.getByRole('button', { name: /Review/ }).click();
      await page.locator('.find-panel summary').click();
      await page.getByLabel('Find text').fill('The archive is locked.');
      await page.getByLabel('Replace with').fill('The archive is sealed with wax.');
      await page.getByRole('button', { name: 'Replace all' }).click();
      await exportPlayable(path);
      await reader.reload();
      await reader.getByRole('button', { name: 'Continue reading' }).click();
      await reader.getByText('You are back where you left off.').waitFor({ timeout: 5000 });
      await reader.getByText('The archive is sealed with wax.').waitFor();
      await reader.getByRole('button', { name: 'Lift the loose floorboard' }).waitFor();
      await reader.getByRole('button', { name: 'Undo' }).click();
      await reader.getByRole('button', { name: 'Search the reading room' }).waitFor();
      await reader.close();
      await page.locator('button[title^="Undo"]').click(); // put the sample text back
      await page.getByRole('button', { name: /Review/ }).click();
      await page.getByText('The archive is locked.').first().waitFor();
    });
    await step('story settings show statistics and keep a draft that can be restored', async () => {
      page.on('dialog', (d) => d.accept());
      await page.getByRole('button', { name: /Review/ }).click();
      await page.locator('.story-entry').click();
      await page.getByRole('heading', { name: 'At a glance' }).waitFor();
      if (!/MIRA/.test(await page.locator('.glance-cast').innerText())) throw new Error('lines per character missing');
      await page.getByLabel('Draft name').fill('First pass');
      await page.getByRole('button', { name: 'Keep a draft' }).click();
      await page.locator('.draft', { hasText: 'First pass' }).waitFor({ timeout: 5000 });
      const title = page.locator('.settings-grid label', { hasText: 'Title' }).locator('input');
      await title.fill('Renamed Archive');
      await page.locator('.project-name', { hasText: 'Renamed Archive' }).waitFor();
      await page.locator('.draft', { hasText: 'First pass' }).getByRole('button', { name: 'Restore' }).click();
      await page.locator('.project-name', { hasText: 'The Locked Archive' }).waitFor({ timeout: 5000 });
      await page.locator('.draft', { hasText: 'Before restoring' }).waitFor({ timeout: 5000 });
    });
    await step('saves the story map as SVG and PNG', async () => {
      await page.getByRole('button', { name: /Graph/ }).click();
      const [svgDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save map' }).click()]);
      const svg = readFileSync(await svgDl.path(), 'utf8');
      if (!/^<\?xml[\s\S]*<svg[\s\S]*A Map of The Locked Archive[\s\S]*Archive Entrance/.test(svg)) throw new Error('map SVG is missing its title or passages');
      if (/class="/.test(svg)) throw new Error('map SVG still depends on the app stylesheet');
      const [pngDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG' }).click()]);
      const png = readFileSync(await pngDl.path());
      if (png.subarray(1, 4).toString() !== 'PNG' || png.length < 5000) throw new Error('map PNG is empty or invalid');
    });
    await step('imports a Final Draft (.fdx) file through the file picker', async () => {
      await page.getByRole('button', { name: /Import/ }).first().click();
      await page.locator('.dropzone input[type=file]').setInputFiles(fileURLToPath(new URL('../fixtures/archive.fdx', import.meta.url)));
      await page.getByText('archive.fdx').waitFor({ timeout: 5000 });
      await page.getByRole('button', { name: /^Convert/ }).click();
      await page.locator('.passage-item', { hasText: 'Cliff Path' }).waitFor({ timeout: 5000 });
    });
    await step('imports a screenplay PDF', async () => {
      await page.getByRole('button', { name: /Import/ }).first().click();
      await page.locator('.dropzone input[type=file]').setInputFiles(fileURLToPath(new URL('../fixtures/lighthouse.pdf', import.meta.url)));
      await page.getByText('lighthouse.pdf').waitFor({ timeout: 15000 });
      await page.getByRole('button', { name: /^Convert/ }).click();
      await page.locator('.passage-item', { hasText: /lamp room/i }).waitFor({ timeout: 10000 });
      await page.locator('.project-name', { hasText: 'THE LIGHTHOUSE KEEPER' }).waitFor();
    });
    await step('the replaced story waits on the Import page as earlier work', async () => {
      await page.getByRole('button', { name: /Import/ }).first().click();
      await page.locator('.drafts .draft', { hasText: 'The Locked Archive' }).waitFor({ timeout: 5000 });
      await page.getByRole('button', { name: /Review/ }).click();
    });
    await step('Logbook shows page and worker entries, and its download has no story text', async () => {
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('ControlOrMeta+l');
      await page.getByRole('tab', { name: 'Logbook' }).waitFor();
      await page.getByLabel('Show log entries from this level up').selectOption('debug');
      await page.locator('.log-entry', { hasText: 'Built story' }).first().waitFor({ timeout: 5000 });
      await page.locator('.log-entry', { hasText: 'Compiled Ink' }).filter({ hasText: 'worker' }).first().waitFor({ timeout: 5000 });
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'download' }).click()]);
      const text = readFileSync(await dl.path(), 'utf8');
      if (!/Processed story/.test(text)) throw new Error('downloaded log is missing pipeline entries');
      if (/Rows of shelves|archive is locked|Wrapped in oilcloth/.test(text)) throw new Error('log contains story text');
      await page.getByRole('tab', { name: 'Diagnostics' }).click();
    });
    await step('attaches a voice clip to a line and ships it in the exports', async () => {
      // A one-second 8 kHz silent WAV.
      const n = 8000;
      const wav = Buffer.alloc(44 + n * 2);
      wav.write('RIFF', 0);
      wav.writeUInt32LE(36 + n * 2, 4);
      wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24);
      wav.writeUInt32LE(16000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write('data', 36);
      wav.writeUInt32LE(n * 2, 40);
      const wavPath = join(mkdtempSync(join(tmpdir(), 'nb-wav-')), 'take1.wav');
      writeFileSync(wavPath, wav);
      await page.locator('.passage-item').first().click();
      await page.locator('.block-dialogue .voice-clip input[type=file]').first().setInputFiles(wavPath);
      await page.locator('.block-dialogue .clip-name').first().waitFor({ timeout: 5000 });
      await page.getByRole('button', { name: /Export/ }).click();
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download playable story/ }).click()]);
      const html = readFileSync(await dl.path(), 'utf8');
      if (!/#audio:vo_|"vo_[^"]+\.wav":"data:audio\/wav;base64,/.test(html)) throw new Error('playable story does not embed the clip');
      await page.getByRole('button', { name: 'Build Unity package' }).click();
      await page.getByText('package verified').waitFor({ timeout: 15000 });
      const [zipDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .zip' }).click()]);
      const zip = await JSZip.loadAsync(readFileSync(await zipDl.path()));
      if (!Object.keys(zip.files).some((f) => /Resources\/NarrativeBridgeAudio\/vo_.+\.wav$/.test(f))) throw new Error('Unity zip has no voice clip');
    });
    await step('opens a Twine story to keep working on it', async () => {
      await page.getByRole('button', { name: /Import/ }).first().click();
      await page.locator('.dropzone input[type=file]').setInputFiles(fileURLToPath(new URL('../fixtures/orchard.twee', import.meta.url)));
      await page.locator('.file-list li', { hasText: 'orchard.twee' }).getByText(/Twine story/).waitFor({ timeout: 5000 });
      await page.getByRole('button', { name: /^Convert/ }).click();
      await page.locator('.passage-item', { hasText: 'Trees' }).waitFor({ timeout: 10000 });
      await page.locator('.project-name', { hasText: 'The Orchard' }).waitFor();
    });
    await step('opens Ink: editable when it can be, kept as written when it uses more', async () => {
      await page.getByRole('button', { name: /Import/ }).first().click();
      await page.locator('.dropzone input[type=file]').setInputFiles([
        fileURLToPath(new URL('../fixtures/gate.ink', import.meta.url)),
        fileURLToPath(new URL('../fixtures/tunnels.ink', import.meta.url)),
      ]);
      const gate = page.locator('.file-list li', { hasText: 'gate.ink' });
      const tunnels = page.locator('.file-list li', { hasText: 'tunnels.ink' });
      if ((await gate.getByLabel(/How to import/).inputValue()) !== 'edit') throw new Error('plain Ink should default to editable');
      await gate.getByText('Everything in it can be edited here.').waitFor();
      if ((await tunnels.getByLabel(/How to import/).inputValue()) !== 'keep') throw new Error('Ink with tunnels should default to kept as written');
      await tunnels.getByText(/tunnels/).waitFor();
      await tunnels.getByRole('button', { name: 'remove' }).click();
      await page.getByRole('button', { name: /^Convert/ }).click();
      await page.locator('.passage-item', { hasText: 'gate' }).first().waitFor({ timeout: 10000 });
      // Editable: the Ink chapter is generated from the story, not passed through.
      await page.getByRole('button', { name: /Ink/ }).first().click();
      if (await page.getByText(/passthrough/).count()) throw new Error('editable Ink was passed through');
      await page.getByRole('button', { name: /Review/ }).click();
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
