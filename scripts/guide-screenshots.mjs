// Captures the screenshots used by the user guide (docs/images/*.jpg) from the offline edition,
// so the pictures always match the app. Rebuild them after UI changes:
//   npm run build:single && node scripts/guide-screenshots.mjs   (needs: npx playwright-core install chromium)
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'docs/images');
mkdirSync(out, { recursive: true });
const app = `file://${encodeURI(join(root, 'release/Narrative-Bridge.html'))}`;
const lighthouse = /const LIGHTHOUSE = `([\s\S]*?)`;/.exec(readFileSync(join(root, 'src/samples.ts'), 'utf8'))[1];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, colorScheme: 'light', acceptDownloads: true });
page.on('dialog', (d) => d.accept());
const shot = async (name, target = page) => {
  await page.waitForTimeout(450); // let page-turn animations settle
  await target.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 82 });
  console.log(`docs/images/${name}.jpg`);
};
const chapter = (name) => page.locator('.tabs .tab', { hasText: name }).click();

await page.goto(app);
await page.getByText('New here? Four steps.').waitFor();
await shot('import');

// A screenplay in Interactive adaptation mode, so Review shows proposals waiting for approval.
await page.getByLabel('File name for pasted text').fill('lighthouse.fountain');
await page.getByLabel('Script text').fill(lighthouse);
await page.locator('.mode', { hasText: 'Interactive adaptation' }).click();
await shot('import-mode', page.locator('.import-grid'));
await page.getByRole('button', { name: /^Convert/ }).click();
await page.locator('.passage-item').first().waitFor();
await page.locator('.passage-item').nth(1).click();
await shot('review');
// Proposed choices waiting for approval (Interactive adaptation).
await page.locator('.passage-item', { hasText: "Keeper's Cottage" }).click();
await page.locator('.choice.choice-pending').first().scrollIntoViewIfNeeded();
await shot('review-proposal');
await page.getByRole('button', { name: 'Approve all' }).click();

await page.locator('.story-entry').click();
await page.getByRole('heading', { name: 'At a glance' }).waitFor();
await shot('story-settings', page.locator('.passage-editor'));

await chapter('Graph');
await page.locator('.node').first().waitFor();
await shot('graph');

await chapter('Ink');
await shot('ink');

await chapter('Playtest');
await page.locator('.transcript').waitFor();
const first = page.locator('.choices .choice-btn').first();
if (await first.count()) await first.click();
await shot('playtest');

await chapter('Export');
await page.getByRole('heading', { name: 'Share without a game engine' }).waitFor();
await shot('export');
await page.getByRole('button', { name: /^Build Unity package/ }).click();
await page.getByText('package verified').waitFor({ timeout: 20000 });
await page.getByText('package verified').scrollIntoViewIfNeeded();
await shot('export-unity');

// The reader's view of the playable story.
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download playable story/ }).click()]);
const story = join(mkdtempSync(join(tmpdir(), 'nb-guide-')), dl.suggestedFilename());
await dl.saveAs(story);
const reader = await browser.newPage({ viewport: { width: 1000, height: 760 }, colorScheme: 'light' });
await reader.goto(`file://${encodeURI(story)}`);
await reader.getByRole('button', { name: 'Begin' }).click();
await reader.waitForTimeout(300);
await reader.screenshot({ path: join(out, 'playable.jpg'), type: 'jpeg', quality: 82 });
console.log('docs/images/playable.jpg');
await reader.close();

// Diagnostics and the Logbook beside Review.
await chapter('Review');
await page.keyboard.press('ControlOrMeta+l');
await page.getByRole('tab', { name: 'Logbook' }).waitFor();
await shot('logbook', page.locator('aside.diagnostics'));

await browser.close();
