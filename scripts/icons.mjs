// Renders the app icons used when the site is installed (public/icon-*.png, public/apple-touch-icon.png):
// the Pen to Ink nib in gold on the top bar's green, with room around it for maskable crops.
// The paths are the ones in src/ui/Logo.tsx. Run: node scripts/icons.mjs   (needs: npx playwright-core install chromium)
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const NIB = 'M8.5 2.5H15.5V5.4C17.9 7.4 19.1 9.5 18.7 11.7L12 19.6L5.3 11.7C4.9 9.5 6.1 7.4 8.5 5.4ZM12 9.2A1.5 1.5 0 1 0 12 12.2A1.5 1.5 0 1 0 12 9.2ZM11.55 13.2H12.45L12.08 18.4H11.92Z';
const STROKE = 'M3.5 22.2C6.2 20.6 8.6 20.6 11.2 21.6C13.8 22.6 16.6 22.4 20.5 20.4';
const mark = `<path fill="#dda15e" fill-rule="evenodd" d="${NIB}"/><path d="M8.5 5.4H15.5" stroke="#283618" stroke-width=".9" opacity=".5"/><path d="${STROKE}" fill="none" stroke="#dda15e" stroke-width="1.6" stroke-linecap="round"/>`;
// The mark sits in the middle 60% (the safe zone for maskable icons).
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
<defs><radialGradient id="g" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="#34461f"/><stop offset="1" stop-color="#283618"/></radialGradient></defs>
<rect width="24" height="24" fill="url(#g)"/>
<g transform="translate(4.8 4.6) scale(.6)">${mark}</g></svg>`;

const browser = await chromium.launch();
mkdirSync(`${root}public`, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${svg(size)}</body></html>`);
  await page.screenshot({ path: `${root}public/${name}` });
  await page.close();
  console.log(`Wrote public/${name}`);
}
await browser.close();
