// Renders the social preview card (public/og.png, 1200×630) shown when the site link is shared:
// the Pen to Ink look (src/ui/pen-to-ink.css) on the striped desk, with the nib from src/ui/Logo.tsx.
// Run: node scripts/og-image.mjs   (needs: npx playwright-core install chromium)
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
// Fonts are embedded as data URIs: a page set with setContent can't load file:// URLs.
const font = (p) => `data:font/woff2;base64,${readFileSync(`${root}node_modules/${p}`).toString('base64')}`;
const NIB = 'M8.5 2.5H15.5V5.4C17.9 7.4 19.1 9.5 18.7 11.7L12 19.6L5.3 11.7C4.9 9.5 6.1 7.4 8.5 5.4ZM12 9.2A1.5 1.5 0 1 0 12 12.2A1.5 1.5 0 1 0 12 9.2ZM11.55 13.2H12.45L12.08 18.4H11.92Z';
const STROKE = 'M3.5 22.2C6.2 20.6 8.6 20.6 11.2 21.6C13.8 22.6 16.6 22.4 20.5 20.4';
const logo = `<svg width="64" height="64" viewBox="0 0 24 24"><path fill="#bc6c25" fill-rule="evenodd" d="${NIB}"/><path d="${STROKE}" fill="none" stroke="#bc6c25" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const chips = ['Ink', 'Twine', 'Ren’Py', 'Unity', 'Unreal'].map((c) => `<span class="chip">${c}</span>`).join('');

const html = `<!doctype html><html><head><style>
@font-face { font-family: 'EB Garamond'; font-weight: 500; src: url('${font('@fontsource/eb-garamond/files/eb-garamond-latin-500-normal.woff2')}'); }
@font-face { font-family: 'EB Garamond'; font-style: italic; src: url('${font('@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff2')}'); }
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url('${font('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')}') format('woff2-variations'); }
html, body { margin: 0; width: 1200px; height: 630px; }
body { background-color: #1d270f; background-image: radial-gradient(ellipse 80% 70% at 50% 0%, #2d3c1a, transparent 70%), repeating-linear-gradient(-45deg, transparent 0 9px, rgba(254,250,224,.04) 9px 10px);
  display: flex; align-items: center; justify-content: center; font-family: 'Inter'; }
.window { width: 1060px; height: 500px; background: #fefae0; border-radius: 22px; position: relative; overflow: hidden; color: #283618;
  box-shadow: 0 0 0 1px rgba(0,0,0,.35), 0 40px 80px -20px rgba(0,0,0,.6); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.bar { position: absolute; top: 0; left: 0; right: 0; height: 52px; background: #283618; display: flex; align-items: center; gap: 8px; padding: 0 22px; }
.bar i { width: 11px; height: 11px; border-radius: 50%; background: rgba(254,250,224,.18); }
.mark { width: 104px; height: 104px; border-radius: 26px; background: #fffdf1; display: flex; align-items: center; justify-content: center; margin-top: 40px;
  box-shadow: 0 0 0 1px rgba(201,185,127,.7), 0 2px 4px rgba(26,36,14,.06), 0 10px 24px -6px rgba(26,36,14,.18); }
h1 { font: 500 104px/1 'EB Garamond'; letter-spacing: -0.02em; margin: 22px 0 8px; }
h1 em { font-style: italic; font-weight: 400; color: #bc6c25; }
.sub { font-size: 32px; font-weight: 550; letter-spacing: -0.02em; color: #3d4a24; margin: 0; }
.chips { display: flex; gap: 10px; margin-top: 26px; }
.chip { font-size: 20px; font-weight: 550; color: #606c38; padding: 6px 16px; border-radius: 999px; background: rgba(96,108,56,.1); box-shadow: 0 0 0 1px rgba(96,108,56,.22); }
</style></head><body><div class="window"><div class="bar"><i></i><i></i><i></i></div>
<div class="mark">${logo}</div><h1>Pen <em>to</em> Ink</h1><p class="sub">Turn a script into a playable story</p><div class="chips">${chips}</div></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
mkdirSync(`${root}public`, { recursive: true });
await page.screenshot({ path: `${root}public/og.png` });
await browser.close();
console.log('Wrote public/og.png');
