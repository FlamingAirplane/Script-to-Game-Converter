import { describe, expect, it } from 'vitest';
import { generateInk } from '../src/core/inkgen';
import { lockedChoices } from '../src/core/gating';
import { SAMPLES } from '../src/samples';
import { build } from './helpers';

// The facts readers need beyond the Ink (which choices are locked, and by what) come out of the same pass that writes
// the Ink, so they can only describe choices the Ink really has.

const inkChoices = (ink: string) => [...ink.matchAll(/^[*+](.*)\[[^\]]*? #id:([\w-]+)\]/gm)].map((m) => ({ id: m[2], line: m[0] }));

describe('reader info from the Ink pass', () => {
  it.each(SAMPLES.map((s) => s.id))('every locked choice in %s is a choice the Ink has, with its conditions', async (id) => {
    const s = SAMPLES.find((x) => x.id === id)!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const { ink, info } = generateInk(project);
    const inInk = new Map(inkChoices(ink).map((c) => [c.id, c.line]));
    for (const g of info.gated) {
      expect(inInk.has(g.choiceId), `${g.passage}: "${g.text}" is in the Ink`).toBe(true);
      expect(inInk.get(g.choiceId)).toMatch(/\{/); // and it is written with a condition
      expect(g.requirements.length).toBeGreaterThan(0);
    }
  });

  it('lists what a locked choice needs, in words, and matches an offered choice by id when the words differ', async () => {
    const { project } = await build('@item key "Brass Key"\n@passage a A\nHall.\n+ {has key} [Unlock] -> a\n+ [Wait] -> a\n', 'g.md', 'structured');
    const { info } = generateInk(project);
    const g = info.gated[0];
    expect(g).toMatchObject({ passage: 'a', text: 'Unlock', forced: false, requirements: [{ words: 'Brass Key' }] });
    const read = () => false;
    expect(lockedChoices(info.gated, 'a', read, ['Wait']).map((l) => l.needs)).toEqual([['Brass Key']]);
    // The story offers it under reworded text (a translation, say): the id still says it is on offer.
    expect(lockedChoices(info.gated, 'a', read, [{ text: 'Ouvrir', id: g.choiceId }])).toEqual([]);
  });

  it('kept Ink still reports its locked choices, from the passages the Ink really has', async () => {
    const ink = '-> hall\n=== hall ===\nA door.\n* {has_key} [Open it]\n    -> END\n+ [Wait]\n    -> END\nVAR has_key = false\n';
    const { project } = await build(ink, 'k.ink', 'structured');
    const generated = generateInk(project);
    expect(generated.info.gated.map((g) => g.text)).toEqual(['Open it']);
  });

  it.each(SAMPLES.map((s) => s.id))('the story info for %s describes exactly what the Ink has', async (id) => {
    const s = SAMPLES.find((x) => x.id === id)!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const { ink, info } = generateInk(project);
    const knots = [...ink.matchAll(/^=== (\w+) ===$/gm)].map((m) => m[1]);
    const entryKnots = info.lines.map((l) => l.path.replace('.', '__'));
    expect(info.passages.map((p) => p.id)).toEqual(knots.filter((k) => !entryKnots.includes(k)));
    for (const l of info.lines) {
      const [passage, label] = l.path.split('.');
      expect(ink).toContain(`=== ${passage}__${label} ===\n-> ${l.path}`); // a game can start there
      expect(ink).toContain(`- (${label}) `);
    }
    for (const v of info.itemVariables) expect(ink).toContain(`VAR ${v} `);
    for (const v of info.variables) expect(ink).toContain(`VAR ${v} = `);
    for (const t of info.cueTags) expect(ink).toContain(`# ${t}\n`);
    for (const e of info.exits) expect(ink).toContain(`[Back to the game: ${e}]`);
  });

  it('kept Ink has no line entries to start at, since none were added to it', async () => {
    const ink = '-> hall\n=== hall ===\nANA: Hi. #speaker:ana\n{&one|two}\n-> END\n';
    const { project } = await build(ink, 'k.ink', 'structured');
    expect(project.inkPassthrough).toBeDefined();
    const info = generateInk(project).info;
    expect(info.lines).toEqual([]);
    expect(info.passages.map((p) => p.id)).toEqual(['hall']);
  });
});
