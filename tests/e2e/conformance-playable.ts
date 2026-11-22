// Runs the reader conformance fixtures (tests/fixtures/conformance) against the exported playable page in Chromium,
// so the page's own reader (PLAYER_JS) is held to the same transcripts as Playtest's. Run with
// `npm run test:conformance:playable`. The lines are read from the page's own save, the choices and why it
// stopped from the buttons it shows.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Compiler } from 'inkjs/full';
import { chromium } from 'playwright-core';
import { buildStory } from '../../src/core/builder';
import { buildPlayableHtml } from '../../src/core/export';
import { processProject } from '../../src/core/pipeline';

interface Step {
  choose?: string;
  lines: { speaker?: string; text?: string; cue?: string; cutscene?: boolean }[];
  choices: string[];
  stop: string;
  exit?: string;
}

const dir = fileURLToPath(new URL('../fixtures/conformance/', import.meta.url));
const runtime = readFileSync(fileURLToPath(new URL('../../node_modules/inkjs/dist/ink.js', import.meta.url)), 'utf8');
const names = readdirSync(dir).filter((f) => f.endsWith('.ink')).map((f) => f.slice(0, -4));

// Any small story will do as the shell: the fixture's compiled Ink replaces its Ink.
const shell = processProject((await buildStory([{ fileName: 'shell.md', text: '@passage a A\nHello.\n@end\n' }], { mode: 'structured' })).project);

const browser = await chromium.launch();
let failed = 0;
for (const name of names) {
  const { steps } = JSON.parse(readFileSync(join(dir, `${name}.steps.json`), 'utf8')) as { steps: Step[] };
  const json = new Compiler(readFileSync(join(dir, `${name}.ink`), 'utf8')).Compile().ToJson()!;
  const html = buildPlayableHtml({ ...shell, compile: { ok: true, json, diagnostics: [] } }, runtime);
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Served from a URL (not setContent) so the page has storage, as it has when a reader opens it.
  await page.route('http://conformance.test/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://conformance.test/');
  await page.click('#begin');
  try {
    let seen = 0;
    for (const [i, step] of steps.entries()) {
      // An exit to the game shows as a Resume button, in place of the choice that Ink has.
      if (step.choose?.startsWith('Back to the game: ')) await page.locator('#choices button', { hasText: 'Resume the story' }).click();
      else if (step.choose !== undefined) await page.locator('#choices button.choice:not(.locked)', { hasText: step.choose }).first().click();
      // A cutscene plays on its own, line by line; skip to its end so the choices show.
      const skip = page.locator('#choices button', { hasText: 'Skip the cutscene' });
      if (await skip.count()) await skip.click();
      const got = await page.evaluate(() => {
        const key = (JSON.parse(document.getElementById('story-meta')!.textContent!) as { saveKey: string }).saveKey;
        const saved = JSON.parse(localStorage.getItem(key) || '{}') as { lines?: Record<string, unknown>[] };
        const buttons = [...document.querySelectorAll<HTMLButtonElement>('#choices button.choice:not(.locked)')].map((b) => ({ text: (b.firstChild?.textContent ?? '').trim(), cls: b.className }));
        return {
          lines: saved.lines ?? [],
          buttons,
          ended: !!document.querySelector('#choices .end'),
          exit: document.querySelector('#choices .game-exit p')?.textContent ?? '',
        };
      });
      const lines = got.lines.filter((l) => !('chosen' in l)).slice(seen);
      seen += lines.length;
      const read = lines.map((l) => (l.cue ? { cue: l.cue } : { ...(l.speaker ? { speaker: l.speaker } : {}), text: l.text, ...(l.cut ? { cutscene: true } : {}) }));
      const exit = /\(([^)]*)\)/.exec(got.exit)?.[1];
      const isExit = step.stop === 'exit';
      const choices = isExit ? [`Back to the game: ${exit}`] : got.buttons.map((b) => b.text);
      const stop = got.ended ? 'end' : got.exit ? 'exit' : got.buttons.length === 1 && got.buttons[0].cls.includes('continue') ? 'pause' : 'choices';
      const where = `${name}, step ${i + 1}`;
      const check = (label: string, a: unknown, b: unknown) => {
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          failed++;
          console.error(`✗ ${where}: ${label}\n    expected ${JSON.stringify(b)}\n    got      ${JSON.stringify(a)}`);
        }
      };
      check('lines', read, step.lines);
      check('choices', choices, step.choices);
      check('stop', stop, step.stop);
      if (isExit) check('exit', exit, step.exit);
    }
    if (errors.length) {
      failed++;
      console.error(`✗ ${name}: page errors: ${errors.join('; ')}`);
    }
    console.log(`${failed ? '…' : '✓'} ${name}`);
  } finally {
    await page.close();
  }
}
await browser.close();
if (failed) {
  console.error(`✗ ${failed} conformance checks failed on the playable page.`);
  process.exit(1);
}
console.log(`✓ The playable page matches all ${names.length} fixtures.`);
