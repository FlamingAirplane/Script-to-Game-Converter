// Writes the PDF fixtures used by the PDF import tests (tests/fixtures/*.pdf) with Chromium:
// a screenplay in standard industry layout (Courier 12, 1.5" left margin, page numbers, a title
// page and a scene number) and a short novel with chapter headings.
// Run: node tests/fixtures/make-pdfs.mjs   (needs: npx playwright-core install chromium)
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const dir = fileURLToPath(new URL('.', import.meta.url));
const filler = 'The lamp room hums with a low mechanical note while the great lens turns, throwing its beam across black water and the long reef beyond, where the swell breaks white and slow.';

const screenplay = `<!doctype html><html><head><style>
@page { size: Letter; margin: 1in 1in 1in 1.5in; }
body { font: 12pt/1 'Courier New', Courier, monospace; margin: 0; }
p { margin: 0 0 12pt; } .t { page-break-after: always; text-align: center; padding-top: 3in; }
.char { margin: 0 0 0 2.2in; } .par { margin: 0 0 0 1.6in; width: 2in; } .dia { margin: 0 0 12pt 1in; width: 3.5in; }
.char + .dia, .par + .dia { margin-top: 0; } .tr { margin-left: 4.5in; } .scene { display: flex; justify-content: space-between; width: 6in; }
</style></head><body>
<div class="t"><p>THE LIGHTHOUSE KEEPER</p><p>Written by</p><p>A. Writer</p></div>
<p class="scene"><span>EXT. LIGHTHOUSE - NIGHT</span><span>1</span></p>
<p>Rain lashes the tower. ${filler}</p>
<p class="char">MARA</p><p class="par">(shouting)</p><p class="dia">Is anyone up there? The light has gone out and the boats are still at sea, every one of them.</p>
<p class="char">KEEPER (O.S.)</p><p class="dia">Go home, Mara.</p>
<p>She tries the door. Locked.</p>
<p class="tr">CUT TO:</p>
<p>INT. LAMP ROOM - CONTINUOUS</p>
<p>${filler} ${filler}</p>
<p class="char">KEEPER</p><p class="dia">Forty years I kept it lit.</p>
<p class="char">MARA</p><p class="dia">Then keep it lit tonight.</p>
${Array.from({ length: 14 }, (_, i) => `<p>${i % 2 ? filler : 'The beam sweeps the water.'}</p>`).join('\n')}
<p class="char">KEEPER</p><p class="dia">Hand me the oil.</p>
<p class="tr">FADE OUT.</p>
</body></html>`;

const novel = `<!doctype html><html><head><style>
@page { size: A5; margin: 0.8in; }
body { font: 11pt/1.45 Georgia, serif; margin: 0; } h1 { font-size: 22pt; margin: 0 0 18pt; page-break-before: always; } h1:first-child { page-break-before: auto; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
</style></head><body>
<h1>Chapter One</h1>
${Array.from({ length: 6 }, (_, i) => `<p>${i === 0 ? 'The keeper had not spoken to anyone in a week.' : ''} ${filler} ${filler}</p>`).join('\n')}
<h1>Chapter Two</h1>
<p>Mara came at dawn with bread and news of the storm. ${filler}</p>
<p>${filler} ${filler} ${filler}</p>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(screenplay);
const pageNumber = '<div style="font: 12pt Courier, monospace; width: 100%; text-align: right; padding-right: 1in"><span class="pageNumber"></span>.</div>';
await page.pdf({ path: `${dir}lighthouse.pdf`, format: 'Letter', preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: pageNumber, footerTemplate: '<span></span>' });
await page.setContent(novel);
await page.pdf({ path: `${dir}novel.pdf`, preferCSSPageSize: true });
await browser.close();
console.log('Wrote tests/fixtures/lighthouse.pdf and novel.pdf');
