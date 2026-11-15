import { describe, expect, it } from 'vitest';
import { buildStory } from '../src/core/builder';
import { processProject } from '../src/core/pipeline';
import { addChoice, choiceTextFor, lineToChoice } from '../src/ui/projectOps';

const script = [
  'INT. HALL - NIGHT',
  '',
  'The hall is dark. A door stands open to the left.',
  '',
  'Mira steps through the door.',
  '',
  'Beyond it, a staircase winds down.',
  '',
  'INT. ROOM - NIGHT',
  '',
  'A lamp burns.',
  '',
].join('\n');
const load = async () => (await buildStory([{ fileName: 'x.fountain', text: script }], { mode: 'faithful' })).project;

describe('turning a line into a choice (Review)', () => {
  it('moves what follows into a new scene the choice leads to', async () => {
    const p = await load();
    const hall = p.passages[0];
    expect(hall.content.map((b) => ('text' in b ? b.text : b.type))).toEqual([
      'The hall is dark. A door stands open to the left.',
      'Mira steps through the door.',
      'Beyond it, a staircase winds down.',
    ]);
    expect(hall.divert).toBe('room');
    const r = lineToChoice(p, 'hall', 1, 'Step through the door', { kind: 'rest' });
    if ('error' in r) throw new Error(r.error);
    expect(r.newPassageId).toBe('hall_step_through_the_door');
    expect(hall.content.map((b) => ('text' in b ? b.text : b.type))).toEqual(['The hall is dark. A door stands open to the left.']);
    expect(hall).toMatchObject({ divert: undefined, isEnding: false });
    expect(hall.choices).toEqual([
      expect.objectContaining({ text: 'Step through the door', target: 'hall_step_through_the_door', origin: 'user_authored', review: 'approved', source: expect.objectContaining({ line: 5 }) }),
    ]);
    const next = p.passages[1];
    expect(next).toMatchObject({ id: 'hall_step_through_the_door', title: 'Step through the door', divert: 'room', isEnding: false, sceneHeading: 'INT. HALL - NIGHT' });
    expect(next.content.map((b) => ('text' in b ? b.text : b.type))).toEqual(['Beyond it, a staircase winds down.']);
    const story = processProject(p);
    expect(story.compile.ok).toBe(true);
    expect(story.analysis.graph.nodes.every((n) => n.reachable)).toBe(true);
    expect(story.generated.ink).toMatch(/\+ \[Step through the door\]\s+-> hall_step_through_the_door/);
  });

  it('carries the passage’s own choices on into the new scene', async () => {
    const p = await load();
    addChoice(p, 'hall')!.text = 'Wait';
    const r = lineToChoice(p, 'hall', 0, 'Look around', { kind: 'rest' });
    if ('error' in r) throw new Error(r.error);
    expect(p.passages[0].choices.map((c) => c.text)).toEqual(['Look around']);
    expect(p.passages[1].choices.map((c) => c.text)).toEqual(['Wait']);
    expect(processProject(p).compile.ok).toBe(true);
  });

  it('leads to a new empty scene, an existing passage, or the end, leaving the other lines in place', async () => {
    const p = await load();
    const a = lineToChoice(p, 'hall', 1, 'Go through', { kind: 'new' });
    if ('error' in a) throw new Error(a.error);
    expect(p.passages[1]).toMatchObject({ id: a.newPassageId, content: [], choices: [], isEnding: true });
    expect(p.passages[0].content).toHaveLength(2);
    const b = lineToChoice(p, 'hall', 1, 'Go to the room', { kind: 'existing', target: 'room' });
    if ('error' in b) throw new Error(b.error);
    expect(b.newPassageId).toBeUndefined();
    const c = lineToChoice(p, 'hall', 0, 'Give up', { kind: 'existing', target: 'END' });
    if ('error' in c) throw new Error(c.error);
    expect(p.passages[0].content).toHaveLength(0);
    expect(p.passages[0].choices.map((x) => [x.text, x.target])).toEqual([
      ['Go through', a.newPassageId],
      ['Go to the room', 'room'],
      ['Give up', 'END'],
    ]);
    expect(processProject(p).compile.ok).toBe(true);
  });

  it('explains what it can’t do', async () => {
    const p = await load();
    expect(lineToChoice(p, 'hall', 9, 'x', { kind: 'new' })).toEqual({ error: 'That line is no longer there.' });
    expect(lineToChoice(p, 'hall', 0, '   ', { kind: 'new' })).toMatchObject({ error: expect.stringMatching(/some words/) });
    expect(lineToChoice(p, 'hall', 0, 'x', { kind: 'existing', target: 'nowhere' })).toEqual({ error: 'That passage no longer exists.' });
    p.passages[0].content.push({ type: 'pause', origin: 'user_authored' });
    expect(lineToChoice(p, 'hall', 3, 'x', { kind: 'new' })).toMatchObject({ error: expect.stringMatching(/narration or dialogue/) });
  });

  it('starts the button text from the line, trimmed to a button’s length', () => {
    expect(choiceTextFor('  “Open the   door.”  ')).toBe('Open the door.');
    expect(choiceTextFor('<b>MIRA</b> lifts the <i>lantern</i>')).toBe('MIRA lifts the lantern');
    const long = choiceTextFor('She pulls the lever, and somewhere far below a great wheel begins to turn, grinding the old stones together');
    expect(long.length).toBeLessThanOrEqual(81);
    expect(long).toMatch(/…$/);
    expect(long).not.toMatch(/[ ,]…$/);
  });
});

describe('marker buttons on the Import page', () => {
  it('puts a marker on its own line at the cursor', async () => {
    const { insertMarker } = await import('../src/ui/MarkerPreview');
    expect(insertMarker('', 0, '@end')).toEqual({ text: '@end\n', cursor: 4 });
    expect(insertMarker('Hello', 5, '@end')).toEqual({ text: 'Hello\n@end\n', cursor: 10 });
    expect(insertMarker('A\nB', 2, '@give key')).toEqual({ text: 'A\n@give key\nB', cursor: 11 });
  });
});
