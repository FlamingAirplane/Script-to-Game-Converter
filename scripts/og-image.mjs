// Renders the social preview card (public/og.png, 1200×630) shown when the site link is shared.
// Run: node scripts/og-image.mjs   (needs: npx playwright-core install chromium)
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
// Fonts are embedded as data URIs: a page set with setContent can't load file:// URLs.
const font = (p) => `data:font/woff2;base64,${readFileSync(`${root}node_modules/@fontsource/${p}`).toString('base64')}`;
const logo = `<svg width="120" height="120" viewBox="0 0 24 24"><path fill="#bc6c25" d="M2 13.4 C 5.6 10.4, 9.4 10, 12 11.6 C 14.6 10, 18.4 10.4, 22 13.4 V 15.2 C 18.4 12.4, 14.6 12.2, 12 13.8 C 9.4 12.2, 5.6 12.4, 2 15.2 Z"/><path d="M5 20.6 C 6.4 16.6, 9.2 14.6, 12 14.4 C 14.8 14.6, 17.6 16.6, 19 20.6 M3 14.6 V 20.6 M21 14.6 V 20.6" fill="none" stroke="#bc6c25" stroke-width="1.6" stroke-linecap="round"/><path d="M2.5 22.6 C 5 21.8, 7 23.2, 9.5 22.6 C 12 22, 14 23.2, 16.5 22.6 C 18.5 22.1, 20 22.8, 21.5 22.6" fill="none" stroke="#bc6c25" stroke-width="1" stroke-linecap="round" opacity=".6"/></svg>`;

const html = `<!doctype html><html><head><style>
@font-face { font-family: 'EB Garamond'; font-style: italic; src: url('${font('eb-garamond/files/eb-garamond-latin-400-italic.woff2')}'); }
@font-face { font-family: 'EB Garamond'; src: url('${font('eb-garamond/files/eb-garamond-latin-400-normal.woff2')}'); }
@font-face { font-family: 'Fell'; src: url('${font('im-fell-english-sc/files/im-fell-english-sc-latin-400-normal.woff2')}'); }
html, body { margin: 0; width: 1200px; height: 630px; }
body { background: radial-gradient(ellipse at 50% 0%, #34461f, #1d270f 75%); display: flex; align-items: center; justify-content: center; }
.page { width: 1060px; height: 500px; background: #fefae0; border-radius: 3px 6px 6px 3px; position: relative;
  box-shadow: 2px 2px 0 #f3ecc9, 4px 4px 0 #ddd1a0, 6px 6px 0 #f3ecc9, 8px 8px 0 #cbbd84, 0 30px 60px rgba(0,0,0,.55);
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #283618; }
.page::before { content: ''; position: absolute; inset: 22px; border: 1.5px solid #c9b97f; outline: 1px solid #e3d8ab; outline-offset: 6px; }
.ribbon { position: absolute; top: -8px; right: 90px; width: 44px; height: 120px; background: linear-gradient(90deg,#7a4316,#bc6c25 35%,#d68a45 50%,#bc6c25 65%,#7a4316); clip-path: polygon(0 0,100% 0,100% 100%,50% 82%,0 100%); }
.edition { font: 22px 'EB Garamond'; letter-spacing: .35em; text-transform: uppercase; color: #5d6440; margin: 8px 0 0; }
h1 { font: 96px/1 'Fell'; margin: 10px 0 6px; letter-spacing: .01em; }
.sub { font: italic 36px 'EB Garamond'; color: #3d4a24; margin: 0; }
.rule { color: #bc6c25; font-size: 28px; margin: 18px 0 10px; }
.meta { font: 24px 'EB Garamond'; color: #5d6440; }
</style></head><body><div class="page"><div class="ribbon"></div>${logo}
<p class="edition">Interactive fiction workshop</p><h1>Narrative Bridge</h1><p class="sub">Turn a script into a playable story</p>
<div class="rule">❦</div><div class="meta">Screenplays &amp; prose → Ink · Twine · Unity · Unreal — right in your browser</div></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
mkdirSync(`${root}public`, { recursive: true });
await page.screenshot({ path: `${root}public/og.png` });
await browser.close();
console.log('Wrote public/og.png');
