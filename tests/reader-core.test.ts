import { describe, expect, it } from 'vitest';
import { readLine, tagValue, cueKind, cuesIn, chosenKey, cutsceneSeconds, endingKey, exitOf, isContinueOnly } from '../src/core/readerCore';
import { READER_CORE_JS } from '../src/core/readerCore.generated';
// @ts-expect-error a plain .mjs script, no types
import { generate } from '../scripts/reader-core.mjs';

describe('reader core', () => {
  it('knows exits, Continue breaks, cues, chosen keys, cutscene times and endings', () => {
    expect(exitOf('Back to the game: fight')).toBe('fight');
    expect(exitOf('Back to the game:  ')).toBeNull();
    expect(exitOf('Go on')).toBeNull();
    expect(isContinueOnly(['Continue'])).toBe(true);
    expect(isContinueOnly(['Continue', 'Stay'])).toBe(false);
    expect(cueKind('music')).toBe('music');
    expect(cueKind('silence')).toBe('stop_music');
    expect(cueKind('door_slam')).toBe('sound');
    expect(cuesIn(['speaker:Ana', 'music:calm', 'shake']).map((c) => c.tag)).toEqual(['music:calm', 'shake']);
    expect(chosenKey('harbour.0.c-1', ' Go ')).toBe('harbour|Go');
    expect(cutsceneSeconds('')).toBe(2);
    expect(cutsceneSeconds('x'.repeat(1000))).toBe(9);
    expect(endingKey('Où est-il <i>?</i>')).toBe('où est il');
  });

  it('splits spoken lines the same way for everyone', () => {
    expect(readLine('Ana: Hello: there', ['speaker:Ana'])).toEqual({ text: 'Hello: there', speaker: 'Ana', who: 'Ana' });
    expect(readLine('Hello', ['speaker:Ana'])).toEqual({ text: 'Hello', who: 'Ana' });
    expect(readLine('Note: not spoken', [])).toEqual({ text: 'Note: not spoken', who: null });
    expect(tagValue(['scene: Dock ', 'speaker:Ana'], 'scene')).toBe('Dock');
    expect(tagValue(['speaker:Ana'], 'audio')).toBeNull();
  });

  it('the page gets exactly the same code, running as plain JavaScript', () => {
    const page = new Function(`${READER_CORE_JS}; return { exitOf, cuesIn, chosenKey, cutsceneSeconds, endingKey, cueKind, idOf, chosenId, wasChosen };`)();
    expect(page.idOf(['speaker:Ana', 'id:l_1'])).toBe('l_1');
    expect(page.wasChosen({ 'id:c_1': 1 }, 'c_1', 'a.0', 'New words')).toBe(true);
    expect(page.wasChosen({ 'a|Old words': 1 }, 'c_1', 'a.0', 'Old words')).toBe(true);
    expect(page.chosenId(null, 'a.0', ' x ')).toBe('a|x');
    expect(page.exitOf('Back to the game: fight')).toBe('fight');
    expect(page.cuesIn(['speaker:Ana', 'music:calm']).map((c: { tag: string }) => c.tag)).toEqual(['music:calm']);
    expect(page.chosenKey('a.b', ' x ')).toBe('a|x');
    expect(page.endingKey('Où est-il ?')).toBe('où est il');
    expect(page.cutsceneSeconds('abc')).toBe(cutsceneSeconds('abc'));
  });

  it('the generated module is up to date', () => {
    const current = (generate() as string).replace(/\r\n/g, '\n');
    expect(current).toContain(JSON.stringify(READER_CORE_JS));
  });
});
