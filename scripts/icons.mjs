// Renders the app icons used when the site is installed (public/icon-*.png, public/apple-touch-icon.png):
// the Narrative Bridge mark in gilt on the cover's green, with room around it for maskable crops.
// Run: node scripts/icons.mjs   (needs: npx playwright-core install chromium)
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const mark = `<path fill="#dda15e" d="M2 13.4 C 5.6 10.4, 9.4 10, 12 11.6 C 14.6 10, 18.4 10.4, 22 13.4 V 15.2 C 18.4 12.4, 14.6 12.2, 12 13.8 C 9.4 12.2, 5.6 12.4, 2 15.2 Z"/><path d="M5 20.6 C 6.4 16.6, 9.2 14.6, 12 14.4 C 14.8 14.6, 17.6 16.6, 19 20.6 M3 14.6 V 20.6 M21 14.6 V 20.6" fill="none" stroke="#dda15e" stroke-width="1.6" stroke-linecap="round"/><path d="M2.5 22.6 C 5 21.8, 7 23.2, 9.5 22.6 C 12 22, 14 23.2, 16.5 22.6 C 18.5 22.1, 20 22.8, 21.5 22.6" fill="none" stroke="#dda15e" stroke-width="1" stroke-linecap="round" opacity=".6"/>`;
// The mark sits in the middle 60% (the safe zone for maskable icons), lifted to centre its weight.
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
<defs><radialGradient id="g" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#3a4d22"/><stop offset="1" stop-color="#283618"/></radialGradient></defs>
<rect width="24" height="24" fill="url(#g)"/><rect x="1.6" y="1.6" width="20.8" height="20.8" fill="none" stroke="#bc6c25" stroke-width=".35" opacity=".7"/>
<g transform="translate(4.8 2.2) scale(.6)">${mark}</g></svg>`;

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
