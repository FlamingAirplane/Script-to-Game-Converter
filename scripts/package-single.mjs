// Turns the single-file Vite build into the file writers receive: release/Narrative-Bridge.html.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const built = `${root}release/.build/index.html`;
const target = `${root}release/Narrative-Bridge.html`;

if (!existsSync(built)) {
  console.error('Single-file build not found. Run: npm run build:single');
  process.exit(1);
}
const html = readFileSync(built, 'utf8');
// Everything must be inlined: an external reference would break when the file is opened from disk.
const external = html.match(/<(?:script|link)[^>]+(?:src|href)="(?!data:)[^"]+"/g);
if (external) {
  console.error(`Build still references external files:\n${external.join('\n')}`);
  process.exit(1);
}
writeFileSync(target, html);
rmSync(`${root}release/.build`, { recursive: true, force: true });
console.log(`Wrote release/Narrative-Bridge.html (${(statSync(target).size / 1024 / 1024).toFixed(2)} MB)`);
