// Accessibility scan (axe-core, WCAG 2.1 A/AA rules) of every tab in light and dark themes,
// run on the writer file opened from disk. `npm run test:a11y` (builds the file first).
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const file = fileURLToPath(new URL('../../release/Narrative-Bridge.html', import.meta.url));
if (!existsSync(file)) {
  console.error('release/Narrative-Bridge.html not found. Run: npm run build:single');
  process.exit(1);
}
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TABS = ['Import', 'Review', 'Graph', 'Ink', 'Playtest', 'Export'];

const browser = await chromium.launch();
let total = 0;
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await page.goto(`file://${encodeURI(file)}`);
  await page.getByText('New here? Four steps.').waitFor();
  for (const tab of TABS) {
    if (tab === 'Review') {
      await page.getByRole('button', { name: /Import/ }).first().click();
      await page.getByText('The Lighthouse Keeper').first().click();
      await page.locator('.passage-item').first().waitFor();
    } else await page.getByRole('button', { name: new RegExp(tab) }).first().click();
    await page.waitForTimeout(400);
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(() =>
      // eslint-disable-next-line no-undef
      axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }),
    );
    for (const v of result.violations) {
      total += v.nodes.length;
      console.log(`✗ ${theme} · ${tab} · ${v.id} (${v.impact}) ×${v.nodes.length}: ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) console.log(`    ${n.target.join(' ')} — ${n.failureSummary.split('\n').slice(1, 2).join(' ').trim()}`);
    }
  }
  // The Logbook side panel.
  await page.keyboard.press('ControlOrMeta+l');
  await page.getByRole('tab', { name: 'Logbook' }).waitFor();
  await page.waitForTimeout(300);
  const log = await page.evaluate(() =>
    // eslint-disable-next-line no-undef
    axe.run(document.querySelector('.diagnostics'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }),
  );
  for (const v of log.violations) {
    total += v.nodes.length;
    console.log(`✗ ${theme} · Logbook · ${v.id} (${v.impact}) ×${v.nodes.length}: ${v.help}`);
    for (const n of v.nodes.slice(0, 3)) console.log(`    ${n.target.join(' ')}`);
  }
  await page.close();
}
await browser.close();
console.log(total ? `\n${total} accessibility issue(s) found.` : '✓ No WCAG 2.1 A/AA violations found in any tab, light or dark.');
process.exit(total ? 1 : 0);
