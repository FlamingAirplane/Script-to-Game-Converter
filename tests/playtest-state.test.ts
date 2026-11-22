import { Compiler } from 'inkjs/full';
import { Story } from 'inkjs';
import { describe, expect, it } from 'vitest';
import type { Line } from '../src/core/reader';
import { isCutscene, nextShown, offered, replayChoices, replayNote } from '../src/ui/playtest/state';

const story = (ink: string) => new Story(new Compiler(ink).Compile().ToJson()!);
const line = (text: string, tags: string[] = [], kind: Line['kind'] = 'text'): Line => ({ text, tags, kind });

describe('Playtest state', () => {
  it('says what happened to a save from another version of the story', () => {
    expect(replayNote('a', 'b', 3, 3)).toContain('all 3 choices');
    expect(replayNote('a', 'b', 1, 1)).toContain('Replayed its choice');
    expect(replayNote('a', 'b', 2, 5)).toContain('2 of 5 choices still exist');
    expect(replayNote('a', 'b', 0, 2)).toContain('None of its 2 choices exist any more');
    expect(replayNote('a', 'b', 1, 1)).toContain('version a → b');
  });

  it('shows a cutscene one line at a time, up to the next cutscene line', () => {
    const cut = ['cutscene'];
    const ls = [line('one', cut), line('two', cut), line('cue', ['music:calm'], 'cue'), line('three', cut), line('after')];
    expect(isCutscene(ls[0])).toBe(true);
    expect(isCutscene(ls[4])).toBe(false);
    expect(nextShown(ls, 1)).toBe(2); // after the first line, the second shows
    expect(nextShown(ls, 2)).toBe(4); // the cue before the third comes with it
    expect(nextShown(ls, 4)).toBe(0); // the cutscene is over
  });

  it('replays a save by choice id when the words changed, else by the words', () => {
    const ink = (go: string) => `-> a\n=== a ===\nHi\n+ [${go} #id:c_go]\n    -> b\n+ [Stay #id:c_stay]\n    -> a\n=== b ===\nThere\n-> END\n`;
    const old = story(ink('Go on'));
    while (old.canContinue) old.Continue();
    expect(offered(old).map((c) => c.id)).toEqual(['c_go', 'c_stay']);
    // The save recorded "Go on" with its id; the story now words it "Move along".
    const now = story(ink('Move along'));
    const byId = replayChoices(now, [{ text: 'Go on', id: 'c_go' }]);
    expect(byId.followed).toBe(1);
    expect(byId.lines.some((l) => l.text === 'There')).toBe(true);
    // An older save has no id: the words must match, and these don't.
    const again = story(ink('Move along'));
    expect(replayChoices(again, [{ text: 'Go on' }]).followed).toBe(0);
  });
});
