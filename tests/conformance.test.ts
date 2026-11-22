import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Compiler } from 'inkjs/full';
import { Story } from 'inkjs';
import { describe, expect, it } from 'vitest';
import { readOn, stopOf, type Line } from '../src/core/reader';

// The reader conformance suite. Each fixture in tests/fixtures/conformance is an Ink story and the transcript every
// reader must produce for it: the lines read (speaker and text, cues, cutscene), the choices offered, and why it
// stopped. Playtest's reader runs here; the playable page, Unity and Unreal run the same fixtures in their own tests.

export interface FixtureLine {
  speaker?: string;
  text?: string;
  cue?: string;
  cutscene?: boolean;
}
export interface FixtureStep {
  choose?: string;
  lines: FixtureLine[];
  choices: string[];
  stop: 'choices' | 'pause' | 'exit' | 'end';
  exit?: string;
}

const dir = join(__dirname, 'fixtures', 'conformance');
const names = readdirSync(dir)
  .filter((f) => f.endsWith('.ink'))
  .map((f) => f.slice(0, -4));

const asFixture = (l: Line): FixtureLine =>
  l.kind === 'cue' ? { cue: l.text } : { ...(l.speaker ? { speaker: l.speaker } : {}), text: l.text, ...(l.tags.includes('cutscene') ? { cutscene: true } : {}) };

describe('reader conformance: Playtest', () => {
  it.each(names)('%s', (name) => {
    const steps: { description: string; steps: FixtureStep[] } = JSON.parse(readFileSync(join(dir, `${name}.steps.json`), 'utf8'));
    const story = new Story(new Compiler(readFileSync(join(dir, `${name}.ink`), 'utf8')).Compile().ToJson()!);
    for (const step of steps.steps) {
      if (step.choose !== undefined) {
        const c = story.currentChoices.find((x) => x.text === step.choose);
        expect(c, `a choice called "${step.choose}"`).toBeDefined();
        story.ChooseChoiceIndex(c!.index);
      }
      const read = readOn(story, []).map(asFixture);
      expect(read).toEqual(step.lines);
      expect(story.currentChoices.map((c) => c.text)).toEqual(step.choices);
      const stop = stopOf(story);
      expect(stop.kind).toBe(step.stop);
      if (step.exit) expect(stop).toEqual({ kind: 'exit', name: step.exit });
    }
  });
});
