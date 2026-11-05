// End-to-end check of the writer edition opened straight from disk (file://), in WebKit (Safari's
// engine) and Chromium. Run with `npm run test:e2e` (builds the file first).
// One-time setup: npx playwright-core install webkit chromium
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
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
  // This page checks the download path (Safari, Firefox). Chromium's Save dialogs need a person to
  // answer them, so hide them here; the "real files" step covers them with a stand-in file system.
  await page.addInitScript(() => {
    for (const k of ['showSaveFilePicker', 'showOpenFilePicker']) Object.defineProperty(window, k, { value: undefined, configurable: true });
  });
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
    await step('browser shortcuts with extra keys (⌘⇧F, ⌘⇧O, ⌘⇧B…) reach the browser; ⌘F still finds', async () => {
      // Record, after the app's own listener, whether each key press was taken by the app.
      await page.evaluate(() => {
        window.__taken = [];
        window.addEventListener('keydown', (e) => e.key.length === 1 && window.__taken.push(`${e.shiftKey ? 'shift+' : ''}${e.altKey ? 'alt+' : ''}${e.key.toLowerCase()}:${e.defaultPrevented}`));
      });
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      for (const k of ['ControlOrMeta+Shift+f', 'ControlOrMeta+Shift+o', 'ControlOrMeta+Shift+b', 'ControlOrMeta+Alt+f', 'ControlOrMeta+Shift+l']) await page.keyboard.press(k);
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
      if (await open.count()) throw new Error('locked choice offered before the key');
      // Locked choices are shown, greyed, with what they need; G hides them.
      const locked = page.locator('.choice-btn.locked', { hasText: 'Open the archive' });
      await locked.getByText('needs Archive Key').waitFor({ timeout: 3000 });
      await page.keyboard.press('g');
      await locked.waitFor({ state: 'detached', timeout: 3000 });
      await page.keyboard.press('g');
      await locked.waitFor({ timeout: 3000 });
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
    await step('a Continue break added on the Graph shows as Continue in Playtest', async () => {
      // The Graph is still open from the step before.
      await page.locator('g.node.start').first().click();
      const panel = page.locator('.map-inspector');
      await panel.waitFor();
      await panel.getByRole('button', { name: /^Add a Continue break/ }).first().click();
      await panel.getByRole('button', { name: /^Remove the Continue break/ }).waitFor();
      await page.locator('.break-sign').first().waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /Playtest/ }).click();
      await page.getByRole('button', { name: /Restart/ }).first().click().catch(() => {});
      const next = page.locator('.choice-btn.continue');
      await next.waitFor({ timeout: 5000 });
      await next.click();
      await next.waitFor({ state: 'detached', timeout: 3000 });
      // Put the story back as it was for the steps that follow.
      await page.keyboard.press('ControlOrMeta+z');
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
    let wavPath = '';
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
      wavPath = join(mkdtempSync(join(tmpdir(), 'nb-wav-')), 'take1.wav');
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
    await step('adds a scene picture and a batch of recordings, and ships the picture', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'nb-media-'));
      // A 16x9 PNG, drawn by hand (no image library needed).
      const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
      const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
      const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(16, 0); ihdr.writeUInt32BE(9, 4); ihdr[8] = 8; ihdr[9] = 2;
      const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 9 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(16 * 3, 90)]))))), chunk('IEND', Buffer.alloc(0))]);
      writeFileSync(join(dir, 'tower.png'), png);
      await page.getByRole('button', { name: /Review/ }).click();
      await page.locator('.passage-item').first().click();
      await page.locator('input[aria-label="Scene picture file"]').setInputFiles(join(dir, 'tower.png'));
      const expect = (locator, what) => locator.waitFor({ timeout: 5000 }).catch(() => { throw new Error(what); });
      await expect(page.locator('.scene-picture', { hasText: '16 × 9' }), 'the picture did not attach in Review');
      await page.getByPlaceholder(/A lighthouse in a storm/).fill('A grey tower');
      await page.getByRole('button', { name: /Playtest/ }).click();
      await page.getByRole('button', { name: /Restart/ }).first().click();
      await expect(page.locator('.t-picture img[alt="A grey tower"]'), 'Playtest does not show the picture');
      await page.getByRole('button', { name: /Export/ }).click();
      // Recordings named by their row in the recording script: "2.wav" is the second line of dialogue.
      writeFileSync(join(dir, '2.wav'), readFileSync(wavPath));
      writeFileSync(join(dir, 'outtake.wav'), readFileSync(wavPath));
      await page.locator('.share-card input[aria-label="Recording files"]').setInputFiles([join(dir, '2.wav'), join(dir, 'outtake.wav')]);
      await expect(page.locator('.share-card [role=status]', { hasText: /Attached 1 recording\. 1 file didn't match a line: outtake\.wav/ }), 'the recordings were not matched as expected');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download playable story/ }).click()]);
      const html = readFileSync(await dl.path(), 'utf8');
      if (!/"img_[^"]+\.png":\{"src":"data:image\\?\/png;base64,/.test(html)) throw new Error('playable story does not embed the picture');
      await page.getByRole('button', { name: 'Build Unity package' }).click();
      await page.getByText('package verified').waitFor({ timeout: 15000 });
      const [zipDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .zip' }).click()]);
      const zip = await JSZip.loadAsync(readFileSync(await zipDl.path()));
      if (!Object.keys(zip.files).some((f) => /Resources\/NarrativeBridgeImages\/img_.+\.png$/.test(f))) throw new Error('Unity zip has no scene picture');
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
    await step('real files: Save writes the project file, ⌘S writes back, Save As and exports pick a file', async () => {
      // A stand-in for the browser's file system (Chrome/Edge's Save and Open dialogs), recording what is written.
      const fs = await browser.newPage({ acceptDownloads: true });
      fs.on('pageerror', (e) => errors.push(`files page: ${e.message}`));
      await fs.addInitScript(() => {
        const files = (window.__files = {});
        window.__picked = [];
        const handle = (name) => ({
          name,
          kind: 'file',
          async getFile() {
            return new File([files[name] ?? ''], name);
          },
          async createWritable() {
            let data = '';
            return { async write(d) { data += typeof d === 'string' ? d : new TextDecoder().decode(d); }, async close() { files[name] = data; } };
          },
          async queryPermission() { return 'granted'; },
          async requestPermission() { return 'granted'; },
          async isSameEntry(o) { return o?.name === name; },
        });
        window.showSaveFilePicker = async ({ suggestedName, id }) => {
          const name = window.__picked.length && id === 'project' ? `copy-${suggestedName}` : suggestedName;
          window.__picked.push(`${id}:${name}`);
          return handle(name);
        };
        window.showOpenFilePicker = async () => [handle(Object.keys(files).find((n) => n.endsWith('.json')))];
      });
      await fs.goto(url);
      await fs.getByText('The Locked Archive').first().click();
      await fs.getByRole('button', { name: /Archive Entrance/ }).waitFor();
      let downloaded = false;
      fs.on('download', () => (downloaded = true));
      const name = 'the_locked_archive.nbproj.json';
      await fs.getByRole('button', { name: 'Save project' }).click();
      await fs.getByText(`✓ saved to ${name}`).waitFor({ timeout: 5000 });
      const saved = () => fs.evaluate((n) => JSON.parse(window.__files[n]).project.project.title, name);
      if ((await saved()) !== 'The Locked Archive') throw new Error('project file was not written');
      // An edit shows as unsaved; ⌘S writes it back to the same file without asking again.
      await fs.locator('.story-entry').click();
      await fs.locator('.settings-grid label', { hasText: 'Title' }).locator('input').fill('Archive, Revised');
      await fs.getByText(`edited · ⌘S saves to ${name}`).waitFor();
      await fs.locator('body').click({ position: { x: 3, y: 3 } });
      await fs.keyboard.press('ControlOrMeta+s');
      await fs.getByText(`✓ saved to ${name}`).waitFor({ timeout: 5000 });
      if ((await saved()) !== 'Archive, Revised') throw new Error('⌘S did not write back to the project file');
      // Save As picks a new file; exports go through the Save dialog, not into Downloads.
      await fs.getByRole('button', { name: 'Save as…' }).click();
      await fs.getByText(`✓ saved to copy-${name}`).waitFor({ timeout: 5000 });
      await fs.getByRole('button', { name: /Export/ }).click();
      await fs.getByRole('button', { name: /Download playable story/ }).click();
      await fs.waitForFunction(() => window.__picked.some((p) => p.startsWith('export-html:')), null, { timeout: 5000 });
      const picked = await fs.evaluate(() => window.__picked);
      if (picked.filter((p) => p.startsWith('project:')).length !== 2 || downloaded) throw new Error(`unexpected saves: ${picked.join(', ')}${downloaded ? ' + a download' : ''}`);
      // The autosave lives in IndexedDB: without the quick localStorage copy, a reload still restores the story.
      await fs.evaluate(() => localStorage.removeItem('narrative-bridge.project.v1'));
      await fs.reload();
      await fs.locator('.project-name', { hasText: 'Archive, Revised' }).waitFor({ timeout: 5000 });
      await fs.close();
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
