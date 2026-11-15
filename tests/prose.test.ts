import { describe, expect, it } from 'vitest';
import { buildStory } from '../src/core/builder';
import { ADAPTERS } from '../src/core/export';
import { conditionInWords, describeNeed, effectInWords } from '../src/core/gating';
import { processProject } from '../src/core/pipeline';
import { SAMPLES } from '../src/samples';

const build = (text: string, fileName = 'story.txt') => buildStory([{ fileName, text }], { mode: 'faithful' });
const spoken = (p: Awaited<ReturnType<typeof build>>['project']) =>
  p.passages.flatMap((x) => x.content).flatMap((b) => (b.type === 'dialogue' ? [`${p.characters.find((c) => c.id === b.speakerId)?.displayName}: ${b.text}`] : []));

describe('prose', () => {
  it('reads quoted speech with a speech tag as a character speaking', async () => {
    const { project } = await build('The vault was cold.\n\n“Take it, or walk away,” said Mira. “But decide now.”\n\nJonas said, "I need a minute."\n');
    expect(project.characters.map((c) => c.displayName)).toEqual(['Mira', 'Jonas']);
    expect(spoken(project)).toEqual(['Mira: Take it, or walk away.', 'Mira: But decide now.', 'Jonas: I need a minute.']);
    // The narration stays narration, and the speech tag isn't kept as a line of its own.
    const narration = project.passages.flatMap((x) => x.content).flatMap((b) => (b.type === 'action' ? [b.text] : []));
    expect(narration).toEqual(['The vault was cold.']);
  });

  it('gives “she said” to the last speaker named and an untagged reply to the other voice, and says it guessed', async () => {
    const { project, diagnostics } = await build('"Is it locked?" asked Mira.\n\n"It always is," Jonas replied.\n\n"Then we wait."\n\n"For what?" he said, turning the key over.\n');
    expect(spoken(project)).toEqual(['Mira: Is it locked?', 'Jonas: It always is.', 'Mira: Then we wait.', 'Mira: For what?']);
    expect(diagnostics.filter((d) => d.code === 'PARSE_AMBIGUOUS_CUE')).toHaveLength(1);
    expect(project.passages[0].content.some((b) => b.type === 'action' && b.text.includes('turning the key over'))).toBe(true);
  });

  it('leaves a quotation in narration alone', async () => {
    const { project } = await build('The sign reads "KEEP OUT". Nobody does.\n');
    expect(project.characters).toHaveLength(0);
    expect(project.passages[0].content.map((b) => b.type)).toEqual(['action']);
  });

  it('starts a new scene at a section break and at a chapter line', async () => {
    const { project } = await build('Prologue\n\nRain on the glass.\n\n* * *\n\nMorning came late.\n\nChapter Two: The Key\n\nThe drawer was open.\n');
    expect(project.passages.map((p) => p.title)).toEqual(['Prologue', 'Section 2', 'Chapter Two: The Key']);
  });

  it('reads prose pasted under a screenplay name, and leaves a real screenplay as it was written', async () => {
    const pasted = await build('The vault was cold.\n\n"Take it," said Mira.\n', 'script.fountain');
    expect(spoken(pasted.project)).toEqual(['Mira: Take it.']);
    // A screenplay with speakers isn't read as prose: a quotation in its action stays action.
    const screenplay = await build('INT. VAULT - NIGHT\n\nMIRA\nTake it.\n\n"Fine," said the echo. Jonas said nothing.\n', 'script.fountain');
    expect(spoken(screenplay.project)).toEqual(['MIRA: Take it.']);
  });
});

describe('plain words', () => {
  it('describes effects, conditions and what a locked choice needs without code', async () => {
    const sample = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await buildStory([{ fileName: sample.fileName, text: sample.text }], { mode: sample.mode });
    const key = project.items[0];
    expect(effectInWords({ type: 'take_item', itemId: key.id }, project)).toBe(`the player loses ${key.displayName}`);
    expect(effectInWords({ type: 'give_item', itemId: key.id }, project)).toBe(`the player gets ${key.displayName}`);
    expect(effectInWords({ type: 'add_var', variableId: 'trust', amount: -2 }, project)).toBe('trust goes down by 2');
    expect(conditionInWords({ type: 'not', condition: { type: 'has_item', itemId: key.id } }, project)).toBe(`the player doesn’t have ${key.displayName}`);
    expect(`Needs ${describeNeed({ type: 'not', condition: { type: 'has_item', itemId: key.id } }, project)}`).toBe(`Needs to be without ${key.displayName}`);
    expect(describeNeed({ type: 'has_item', itemId: key.id }, project)).toBe(key.displayName);
  });
});

describe('engine exports', () => {
  it('Unity imports the TextMeshPro essentials on first open; Unreal keeps the newest line in view and names its tested versions', async () => {
    const sample = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await buildStory([{ fileName: sample.fileName, text: sample.text }], { mode: sample.mode });
    const s = processProject(project);
    const unity = await ADAPTERS.unity.export(s, { engine: 'unity', projectName: 'P', engineVersion: '6000.3', integrationRef: 'v1.21.0', includeDemo: true });
    const setup = unity.files.find((f) => f.path.endsWith('Editor/TextMeshProSetup.cs'));
    expect(String(setup?.content)).toContain('TMP Essential Resources.unitypackage');
    expect(unity.files.map((f) => String(f.content)).join('\n')).not.toContain('Needs no ');
    const unreal = await ADAPTERS.unreal.export(s, { engine: 'unreal', projectName: 'P', engineVersion: '5.7', integrationRef: 'v1.42.21-release', includeDemo: true });
    const cpp = unreal.files.map((f) => String(f.content)).join('\n');
    expect(cpp).toContain('if (ScrollFrames > 0 && Scroll) { Scroll->ScrollToEnd(); --ScrollFrames; }');
    expect(cpp).toContain('built and tested with Unreal Engine 5.7');
    expect(cpp).not.toContain('"no ');
  });
});

describe('decision rule', () => {
  it('proposes a decision for “Take it, or walk away. But decide now.” and ignores a plain “or”', async () => {
    const { decisionSuggester } = await import('../src/core/rules');
    const text = '@passage vault Vault\nThe key lay on the plinth.\nTake it, or walk away. But decide now.\n-> after\n\n@passage after After\nShe left.\n@end\n';
    const { project } = await buildStory([{ fileName: 'a.fountain', text }], { mode: 'structured' });
    const found = await decisionSuggester.suggest(project);
    expect(found.map((p) => [p.kind, p.passageId, p.choices.map((c) => c.text)])).toEqual([['decision', 'vault', ['Take it', 'Walk away']]]);
    const plain = await buildStory([{ fileName: 'a.fountain', text: text.replace(' But decide now.', '') }], { mode: 'structured' });
    expect(await decisionSuggester.suggest(plain.project)).toEqual([]);
  });
});
