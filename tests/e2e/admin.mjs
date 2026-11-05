// End-to-end check of the admin design editor (#admin) in WebKit and Chromium, on a site built with
// a password. The password is made up for this run and the build goes to a temporary folder, so it
// never reaches a release. Run with `npm run test:admin`.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright-core';
import { build } from 'vite';

const password = `pw-${randomBytes(9).toString('base64url')}`;
const out = mkdtempSync(join(tmpdir(), 'nb-admin-'));
process.env.NB_ADMIN_PASSWORD = password;
await build({ root: fileURLToPath(new URL('../..', import.meta.url)), logLevel: 'warn', build: { outDir: out, emptyOutDir: true } });
delete process.env.NB_ADMIN_PASSWORD;
for (const f of ['index.html']) if (!existsSync(join(out, f))) throw new Error(`build has no ${f}`);
const bundle = readFileSync(join(out, 'index.html'), 'utf8');
if (bundle.includes(password)) throw new Error('the password itself was built in');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, '');
  const file = normalize(join(out, path || 'index.html'));
  if (!file.startsWith(out) || !existsSync(file) || file.endsWith('/')) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let failed = false;
for (const [name, type] of [['WebKit', webkit], ['Chromium', chromium]]) {
  let browser;
  try {
    browser = await type.launch();
  } catch (e) {
    console.error(`${name}: could not launch (${e.message.split('\n')[0]}). Run: npx playwright-core install webkit chromium`);
    failed = true;
    continue;
  }
  console.log(name);
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
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
  const style = (sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);
  const editor = page.getByRole('dialog', { name: 'Design editor', exact: true });
  try {
    await step('visitors get no editor, no draft, and none of its code', async () => {
      await page.goto(url);
      await page.getByText('New here? Four steps.').waitFor();
      if (await page.locator('#nb-admin-host').count()) throw new Error('editor on the page');
      // (The offline service worker may cache it with every other file; the page itself never runs it.)
      if (await page.evaluate(() => performance.getEntriesByType('resource').some((e) => /AdminRoot/.test(e.name)))) throw new Error('the page loaded the editor’s code');
      if ((await style('.btn', 'borderTopLeftRadius')) !== '3px') throw new Error('not the built-in design');
    });
    await step('#admin asks for the password and refuses a wrong one', async () => {
      await page.goto(`${url}#admin`);
      const field = page.getByLabel('Password');
      await field.fill('not it');
      await page.getByRole('button', { name: 'Unlock' }).click();
      await page.getByText('That isn’t the password.').waitFor();
      if (await editor.count()) throw new Error('editor opened');
    });
    await step('the right password opens the editor over the app', async () => {
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Unlock' }).click();
      await editor.waitFor();
      await page.getByText('New here? Four steps.').waitFor();
    });
    await step('a design variable changes the app live', async () => {
      await editor.getByRole('searchbox', { name: 'Find a variable' }).fill('button corners');
      await editor.getByRole('spinbutton', { name: 'Button corners value' }).fill('12');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.btn')).borderTopLeftRadius === '12px');
    });
    await step('any CSS rule can be changed', async () => {
      await editor.getByRole('tab', { name: 'Every rule' }).click();
      await editor.getByRole('searchbox', { name: 'Find a rule' }).fill('.lede');
      const field = editor.getByRole('textbox', { name: '.lede font-size', exact: true });
      await field.fill('21px');
      await field.press('Enter');
      if ((await style('.lede', 'fontSize')) !== '21px') throw new Error(await style('.lede', 'fontSize'));
    });
    await step('words change, and undo takes a change back', async () => {
      await editor.getByRole('tab', { name: 'Words' }).click();
      const brand = editor.getByRole('textbox', { name: 'Name on the cover band' });
      await brand.fill('Story Forge');
      await brand.press('Enter');
      await page.locator('.brand span', { hasText: 'Story Forge' }).waitFor();
      await editor.getByRole('button', { name: 'Undo' }).click();
      await page.locator('.brand span', { hasText: 'Narrative Bridge' }).waitFor();
    });
    let saved;
    await step('the draft downloads as a design file for publishing', async () => {
      await editor.getByRole('tab', { name: 'Save & publish' }).click();
      const [dl] = await Promise.all([page.waitForEvent('download'), editor.getByRole('button', { name: 'Download published.json' }).click()]);
      saved = JSON.parse(readFileSync(await dl.path(), 'utf8'));
      if (saved.format !== 'narrative-bridge-design' || saved.tokens['--radius'] !== '12px' || saved.rules['.lede']?.['font-size'] !== '21px' || saved.words.brand) throw new Error(JSON.stringify(saved));
    });
    await step('closing keeps the draft (only in this browser), with a way back in', async () => {
      await editor.getByRole('button', { name: 'Close the editor' }).click();
      await page.locator('#nb-admin-host').waitFor({ state: 'detached' });
      if (page.url().includes('#admin')) throw new Error('#admin still in the address');
      await page.reload();
      await page.getByRole('button', { name: 'Design draft' }).waitFor();
      if ((await style('.btn', 'borderTopLeftRadius')) !== '12px') throw new Error('draft not shown after a reload');
      await page.getByRole('button', { name: 'Design draft' }).click();
      await editor.waitFor(); // still unlocked in this tab
    });
    await step('another visitor still sees the published design', async () => {
      const other = await browser.newContext();
      const p2 = await other.newPage();
      await p2.goto(url);
      await p2.getByText('New here? Four steps.').waitFor();
      const r = await p2.evaluate(() => getComputedStyle(document.querySelector('.btn')).borderTopLeftRadius);
      const pill = await p2.getByRole('button', { name: 'Design draft' }).count();
      await other.close();
      if (r !== '3px' || pill) throw new Error(`radius ${r}, pill ${pill}`);
    });
    await step('locking closes it, and repeated wrong passwords make you wait', async () => {
      await editor.getByRole('tab', { name: 'Save & publish' }).click();
      await editor.getByRole('button', { name: 'Lock the editor' }).click();
      for (let i = 0; i < 5; i++) {
        await page.getByLabel('Password').fill(`wrong ${i}`);
        await page.getByRole('button', { name: 'Unlock' }).click();
        await page.getByText(/isn’t the password|Too many tries/).waitFor();
      }
      await page.getByText(/Try again in \d+ s/).waitFor();
      if (await page.getByRole('button', { name: 'Unlock' }).isEnabled()) throw new Error('can still try');
    });
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
  } catch {
    failed = true;
  } finally {
    await browser.close();
  }
}
server.close();
process.exit(failed ? 1 : 0);
