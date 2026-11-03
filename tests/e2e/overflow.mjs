// Checks that no screen of the app can scroll sideways, at phone to desktop widths: neither the
// page itself nor any inner panel. Run with `npm run test:overflow` (builds the file first).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const file = fileURLToPath(new URL('../../release/Narrative-Bridge.html', import.meta.url));
if (!existsSync(file)) {
  console.error('release/Narrative-Bridge.html not found. Run: npm run build:single');
  process.exit(1);
}
const WIDTHS = (process.env.WIDTHS ?? '360,414,768,1024,1280,1366,1440,1536,1920').split(',').map(Number);
const TABS = ['Import', 'Review', 'Graph', 'Ink', 'Playtest', 'Export'];
const browser = await chromium.launch();
const problems = [];

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 860 } });
  await page.goto(`file://${encodeURI(file)}`);
  await page.getByText('New here? Four steps.').waitFor();
  await page.waitForTimeout(400); // let the page-turn animation finish
  const check = async (where) => {
    // Sample during a chapter's page-turn too: the animation must not widen the page either.
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const pageOverflow = document.documentElement.scrollWidth - vw;
      // Inner elements that can scroll sideways (a horizontal scrollbar the reader could use).
      const inner = [...document.querySelectorAll('body *')]
        .filter((el) => {
          const cs = getComputedStyle(el);
          if (!/(auto|scroll)/.test(cs.overflowX)) return false;
          return el.scrollWidth - el.clientWidth > 1 && el.clientWidth > 0;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} (+${el.scrollWidth - el.clientWidth}px)`);
      // Elements sticking out past the window edge (unless an ancestor clips them, e.g. inside the map).
      const clipped = (el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return true;
        return false;
      };
      const out = [...document.querySelectorAll('body *')]
        .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !clipped(el); })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} (right ${Math.round(el.getBoundingClientRect().right)})`);
      return { pageOverflow, inner: [...new Set(inner)].slice(0, 6), out: [...new Set(out)].slice(0, 6) };
    });
    if (r.pageOverflow > 0 || r.inner.length || r.out.length) problems.push(`${width}px · ${where}: page +${r.pageOverflow}px${r.out.length ? ` · sticks out: ${r.out.join(', ')}` : ''}${r.inner.length ? ` · scrolls sideways: ${r.inner.join(', ')}` : ''}`);
  };
  await check('Import');
  await page.getByText('The Lighthouse Keeper').first().click();
  await page.locator('.passage-item').first().waitFor();
  await page.waitForTimeout(400);
  for (const tab of TABS.slice(1)) {
    await page.getByRole('button', { name: new RegExp(tab) }).first().click();
    await page.waitForTimeout(350);
    if (tab === 'Export') {
      await page.getByRole('button', { name: 'Build Unity package' }).click().catch(() => {});
      await page.getByText('package verified').waitFor({ timeout: 8000 }).catch(() => {});
    }
    await check(tab);
  }
  await page.getByRole('button', { name: /Review/ }).first().click();
  await page.keyboard.press('ControlOrMeta+l');
  await page.waitForTimeout(300);
  await check('Review + Logbook');
  await page.close();
}
await browser.close();
if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`\n✗ ${problems.length} screen(s) can scroll sideways.`);
  process.exit(1);
}
console.log(`✓ No sideways scrolling at ${WIDTHS.join(', ')} px in any chapter.`);
