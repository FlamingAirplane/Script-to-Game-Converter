import { describe, expect, it } from 'vitest';
import { Compiler } from 'inkjs/full';
import { Story } from 'inkjs';
import { ensureIds, lacksIds, withIds } from '../src/core/ids';
import { generateInk } from '../src/core/inkgen';
import { processProject } from '../src/core/pipeline';
import { chosenId, wasChosen } from '../src/core/chosen';
import { idOf } from '../src/core/readerCore';
import { carryTranslations, translate, translationKey } from '../src/core/export/translations';
import { SAMPLES } from '../src/samples';
import { build } from './helpers';

const lineIds = (p: { passages: { content: { type: string; id?: string }[] }[] }) => p.passages.flatMap((q) => q.content.filter((b) => b.type === 'dialogue' || b.type === 'action' || b.type === 'transition').map((b) => b.id));

describe('stable ids', () => {
  it('gives every line an id when the story is built, the same ones every time', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const a = (await build(s.text, s.fileName, 'structured')).project;
    const b = (await build(s.text, s.fileName, 'structured')).project;
    expect(lacksIds(a)).toBe(false);
    expect(lineIds(a)).toEqual(lineIds(b));
    expect(new Set(lineIds(a)).size).toBe(lineIds(a).length);
  });

  it('writes ids into the Ink and the story still compiles and passes its checks', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const ink = generateInk(project).ink;
    expect(ink).toMatch(/ #speaker:\w+ #id:l_[0-9a-f]{6}/);
    expect(ink).toMatch(/\[[^\]]+ #id:\w+\]/);
    const r = processProject(project);
    expect(r.compile.ok).toBe(true);
    expect(r.state).toBe('Succeeded');
  });

  it('keeps a line’s and a choice’s id when its words are edited', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const p = project.passages.find((q) => q.choices.length)!;
    const line = p.content.find((b) => b.type === 'dialogue' || b.type === 'action')!;
    const before = (line as { id?: string }).id;
    const choiceId = p.choices[0].id;
    (line as { text: string }).text = 'Something else entirely.';
    p.choices[0].text = 'A reworded choice';
    ensureIds(project);
    expect((line as { id?: string }).id).toBe(before);
    const ink = generateInk(project).ink;
    expect(ink).toContain(`#id:${before}`);
    expect(ink).toContain(`[A reworded choice #id:${choiceId}]`);
  });

  it('gives a project from before ids the same ids every time, without touching the original', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    for (const p of project.passages) for (const b of p.content) if ('id' in b) delete (b as { id?: string }).id;
    expect(lacksIds(project)).toBe(true);
    const a = withIds(project);
    expect(lacksIds(project)).toBe(true);
    expect(lineIds(a)).toEqual(lineIds(withIds(project)));
    expect(processProject(project).generated.ink).toBe(generateInk(a).ink);
  });

  it('reads ids back from Ink, so Pen to Ink’s own Ink keeps them through a round trip', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const ink = generateInk(project).ink;
    const again = (await build(ink, 'a.ink', 'structured')).project;
    const noLines = (t: string) => t.replace(/ \(source line \d+\)/g, ''); // where a passage began in the source differs, not its ids
    expect(noLines(generateInk(again).ink)).toBe(noLines(ink));
  });

  it('remembers a choice taken before by its id, so rewording it doesn’t lose the mark', () => {
    const story = (text: string) => {
      const s = new Story(new Compiler(`-> a\n=== a ===\nHi\n* [${text} #id:c_go]\n    -> END\n`).Compile().ToJson()!);
      while (s.canContinue) s.Continue();
      return s;
    };
    const old = story('Go on'), reworded = story('Go on, then');
    const before = old.currentChoices[0];
    expect(idOf(before.tags ?? [])).toBe('c_go');
    const known = { [chosenId('c_go', before.sourcePath, before.text)]: 1 };
    const now = reworded.currentChoices[0];
    expect(wasChosen(known, idOf(now.tags ?? []), now.sourcePath, now.text)).toBe(true);
    // An older mark ("knot|text") still counts when the words are the same.
    expect(wasChosen({ 'a|Go on, then': 1 }, 'c_go', now.sourcePath, now.text)).toBe(true);
    expect(wasChosen({ 'a|Something else': 1 }, 'c_go', now.sourcePath, now.text)).toBe(false);
  });

  it('moves a translation to the reworded text, so fixing a typo keeps it', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const p = project.passages.find((q) => q.choices.length)!;
    const choice = p.choices[0];
    const line = p.content.find((b) => b.type === 'dialogue')!;
    project.translations = { languages: ['fr'], strings: { [translationKey(choice.text)]: { fr: 'Ouvrir' }, [translationKey((line as { text: string }).text)]: { fr: 'Bonjour' } } };
    const before = structuredClone(project);
    const oldChoice = choice.text;
    choice.text = `${oldChoice}!`;
    (line as { text: string }).text += ' (fixed)';
    expect(carryTranslations(before, project)).toBe(2);
    expect(translate(project, 'fr', choice.text)).toBe('Ouvrir');
    expect(translate(project, 'fr', (line as { text: string }).text)).toBe('Bonjour');
    expect(project.translations.strings[translationKey(oldChoice)]).toBeUndefined();
  });

  it('leaves a translation where it is when another line still says the old words', async () => {
    const { project } = await build('INT. A - DAY\n\nMIRA\nHello.\n\nMIRA\nHello.\n', 'x.fountain');
    const lines = project.passages.flatMap((q) => q.content).filter((b) => b.type === 'dialogue');
    project.translations = { languages: ['fr'], strings: { [translationKey('Hello.')]: { fr: 'Salut.' } } };
    const before = structuredClone(project);
    (lines[0] as { text: string }).text = 'Hello there.';
    expect(carryTranslations(before, project)).toBe(1);
    expect(project.translations.strings[translationKey('Hello.')]).toEqual({ fr: 'Salut.' });
    expect(project.translations.strings[translationKey('Hello there.')]).toEqual({ fr: 'Salut.' });
  });
});
