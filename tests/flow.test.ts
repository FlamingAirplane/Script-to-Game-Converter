import { describe, expect, it } from 'vitest';
import { reviewAll } from '../src/core/adapt';
import { passageFlow } from '../src/core/flow';
import { buildRenpy } from '../src/core/export/renpy';
import { buildTwee } from '../src/core/export/twine';
import { processProject } from '../src/core/pipeline';
import { SAMPLES } from '../src/samples';
import { build } from './helpers';

// Where a passage leads is decided once (flow.ts); the Ink, the Twine export and the Ren'Py export only write it in
// their own language. These tests check the decision, and that each output wrote what was decided.

const EXTRA: [string, string][] = [
  ['forced', '@item key "Key"\n@passage a A\nHall.\n+ {has key} [Use it] -> b @forced\n+ [Wait] -> a\n@passage b B\nDone.\n@end\n'],
  ['fallback', '@var t = 0\n@passage a A\nHall.\n+ {t >= 2} [Door] -> c\n* [Once] -> a\n@passage b B\nThen here.\n@end\n@passage c C\nDoor.\n@end\n'],
  ['plain', '@passage a A\nHello.\n+ [Go] -> b\n+ [Stay] -> a\n@passage b B\nBye.\n@end\n'],
];

describe('passage flow', () => {
  it('offers the approved choices, with a forced choice keeping the others out', async () => {
    const { project } = await build(EXTRA[0][1], 'f.md', 'structured');
    const flow = passageFlow(project.passages.find((p) => p.id === 'a')!);
    expect(flow.choices.map((f) => f.choice.text)).toEqual(['Use it', 'Wait']);
    expect(flow.choices[0].guards).toEqual([]); // the forced choice itself isn't guarded
    expect(flow.choices[1].guards).toHaveLength(1); // the other one gives way while it applies
    expect(flow.choices[1].conditions).toHaveLength(1);
  });

  it('goes to the "then", or the end, and says when a fallback can ever be taken', () => {
    const choice = (id: string, extra: object = {}) => ({
      id,
      text: id,
      target: 'c',
      conditions: [],
      effects: [],
      once: false,
      origin: 'source' as const,
      review: 'approved' as const,
      ...extra,
    });
    const needs = [{ type: 'has_item' as const, itemId: 'key' }];
    // Every choice can be unavailable (one has a condition, one is once-only): the fallback can be taken.
    const guarded = passageFlow({ choices: [choice('a', { conditions: needs }), choice('b', { once: true })], divert: 'next', isEnding: false });
    expect(guarded).toMatchObject({ then: 'next', thenIsReachable: true });
    // One choice is always on offer: the fallback is written but can never be taken.
    const open = passageFlow({ choices: [choice('a', { conditions: needs }), choice('b')], divert: 'next', isEnding: false });
    expect(open).toMatchObject({ then: 'next', thenIsReachable: false });
    // An ending with conditional choices falls back to the end; a passage with choices and nowhere to go has no fallback.
    expect(passageFlow({ choices: [choice('a', { conditions: needs })], isEnding: true })).toMatchObject({ then: 'END', thenIsReachable: true });
    expect(passageFlow({ choices: [choice('a')], isEnding: false })).toMatchObject({ then: null, thenIsReachable: false });
    // No choices: it goes on to the next passage, or ends.
    expect(passageFlow({ choices: [], divert: 'next', isEnding: false })).toMatchObject({ then: 'next', thenIsReachable: true });
    expect(passageFlow({ choices: [], isEnding: true })).toMatchObject({ then: 'END', thenIsReachable: true });
    // A choice that isn't approved is not offered.
    expect(passageFlow({ choices: [choice('a', { review: 'pending' })], isEnding: false }).choices).toEqual([]);
  });
});

describe('every output writes the flow that was decided', () => {
  const stories = [
    ...SAMPLES.map((s) => ({ id: s.id, text: s.text, fileName: s.fileName, mode: s.mode })),
    ...EXTRA.map(([id, text]) => ({ id, text, fileName: `${id}.md`, mode: 'structured' as const })),
  ];
  it.each(stories.map((s) => s.id))('%s: Ink, Twine and Ren’Py agree on where each passage goes', async (id) => {
    const s = stories.find((x) => x.id === id)!;
    const { project } = await build(s.text, s.fileName, s.mode);
    reviewAll(project, 'approved');
    const story = processProject(project, [], { skipSmoke: true });
    const ink = story.generated.ink;
    const rpy = buildRenpy(story);
    const twee = buildTwee(story, 'sugarcube');
    for (const p of project.passages) {
      const flow = passageFlow(p);
      // Ink: the passage's knot ends in the fallback "+ -> then" (with choices) or "-> then" (without).
      const knot = ink.split(/^=== /m).find((k) => k.startsWith(`${p.id} ===`))!;
      const last = knot
        .split(/^\/\/ Where a game can start/m)[0]
        .trimEnd()
        .split('\n')
        .pop()!
        .trim();
      if (flow.choices.length) expect(last, `${p.id} in the Ink`).toBe(flow.then ? `+ -> ${flow.then}` : last);
      else expect(last, `${p.id} in the Ink`).toBe(`-> ${flow.then}`);
      if (flow.choices.length && !flow.then) expect(last, `${p.id} has no fallback in the Ink`).not.toMatch(/^\+ ->/);
      // Ren'Py: the label ends in a jump to the same place (or stops).
      const label = rpy.split(/^label /m).find((k) => k.startsWith(`p_${p.id}:`))!;
      const end = label.trimEnd().split('\n').pop()!.trim();
      expect(end, `${p.id} in Ren'Py`).toBe(
        flow.then ? `jump ${flow.then === 'END' ? 'nb_the_end' : `p_${flow.then}`}` : 'return  # nowhere to go: the story stops here',
      );
      // Twine (SugarCube): a fallback link is written exactly when the fallback can be taken alongside choices.
      const title = p.title
        .replace(/[[\]{}|<>]/g, ' ')
        .replace(/->|<-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const passage = twee.split(/^:: /m).find((k) => k.startsWith(`${title} `) || k.startsWith(`${title}\n`));
      if (passage && !p.content.some((b) => b.type === 'pause' || b.type === 'exit') && flow.choices.length)
        expect(/<<if not /.test(passage) && /\[\[Continue->|@@\.end;/.test(passage), `${p.id} in Twine`).toBe(flow.thenIsReachable);
    }
  });
});
