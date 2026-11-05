// npm run design:publish -- <design.json>
// Checks a design file saved from the admin design editor (#admin → Save & publish) and makes it
// the published design (src/ui/design/published.json). Commit and push to main to put it live.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DESIGN_FORMAT, designChanges, normaliseDesign } from '../src/ui/design/design';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run design:publish -- <path to the design file from the editor>');
  process.exit(2);
}
let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`Couldn't read ${file}: ${(e as Error).message}`);
  process.exit(1);
}
if ((raw as { format?: string })?.format !== DESIGN_FORMAT) {
  console.error(`${file} isn't a Narrative Bridge design file (its "format" should be "${DESIGN_FORMAT}").`);
  process.exit(1);
}
const design = normaliseDesign(raw);
const target = fileURLToPath(new URL('../src/ui/design/published.json', import.meta.url));
writeFileSync(target, JSON.stringify(design, null, 2) + '\n');
console.log(`Published "${design.name}" (${designChanges(design)} changes) to src/ui/design/published.json.`);
console.log('Commit and push it to main; GitHub Pages rebuilds the site with it.');
