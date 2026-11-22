import { describe, expect, it } from 'vitest';
import { flowNote, setThen } from '../src/ui/projectOps';
import { build } from './helpers';

// A script flows from one passage to the next; in Ink and Twine, a passage that says nowhere to go is an ending. The
// conversion records which rule it applied, so Review can say so instead of leaving the writer to guess.

describe('how the conversion decided where a passage goes', () => {
  it('a script goes on to the next passage, and ends at the last one', async () => {
    const { project } = await build('INT. A - DAY\n\nOne.\n\nINT. B - DAY\n\nTwo.\n\nINT. C - DAY\n\nThree.\n', 's.fountain');
    const [a, b, c] = project.passages;
    expect(a).toMatchObject({ divert: b.id, flowDefault: 'next_passage' });
    expect(b).toMatchObject({ divert: c.id, flowDefault: 'next_passage' });
    expect(c).toMatchObject({ isEnding: true, flowDefault: 'last_passage' });
    expect(flowNote(a)).toContain('scripts read from one passage to the next');
    expect(flowNote(c)).toContain('last passage');
  });

  it('Ink and Twine stories end a passage that says nowhere to go', async () => {
    const { project } = await build('-> a\n=== a ===\nHello.\n=== b ===\nSecond.\n-> END\n', 's.ink');
    const a = project.passages.find((p) => p.id === 'a')!;
    expect(a).toMatchObject({ isEnding: true, flowDefault: 'source_ends' });
    expect(flowNote(a)).toContain('Ink and Twine stories spell out');
  });

  it('nothing is recorded where the source or the writer said where it goes', async () => {
    const { project } = await build('@passage a A\nOne.\n-> b\n@passage b B\nTwo.\n@end\n', 'm.md');
    for (const p of project.passages) {
      expect(p.flowDefault).toBeUndefined();
      expect(flowNote(p)).toBeNull();
    }
  });

  it('is cleared when the writer sets "Then" themselves', async () => {
    const { project } = await build('INT. A - DAY\n\nOne.\n\nINT. B - DAY\n\nTwo.\n', 's.fountain');
    const a = project.passages[0];
    expect(a.flowDefault).toBe('next_passage');
    setThen(a, '__end');
    expect(a).toMatchObject({ isEnding: true, divert: undefined });
    expect(a.flowDefault).toBeUndefined();
    setThen(a, project.passages[1].id);
    expect(a).toMatchObject({ isEnding: false, divert: project.passages[1].id });
    expect(flowNote(a)).toBeNull();
  });
});
