import { describe, expect, it } from 'vitest';
import { reviewAll } from '../src/core/adapt';
import { buildStory } from '../src/core/builder';
import { generateInk } from '../src/core/inkgen';
import { processProject } from '../src/core/pipeline';
import { applyProposals, cleanLabel, firstSentence, SUGGESTION_DROPPED } from '../src/core/proposals';
import { cheapRules, questionSuggester, widerPickupSuggester } from '../src/core/rules';
import { createModelSuggester, type ChatMessage, type Generator } from '../src/suggest/model';
import { buildPrompt, itemPhrase, MOMENT_SCHEMA, parseReply, promptLines, windows } from '../src/suggest/prompt';
import { SAMPLES } from '../src/samples';

const sample = (id: string) => SAMPLES.find((s) => s.id === id)!;
const bare = async (id: string) => (await buildStory([{ fileName: sample(id).fileName, text: sample(id).text }], { mode: 'adaptation', heuristics: false })).project;

/** A stand-in model: replies by scene heading; `calls` records every prompt it saw. */
function canned(replies: Record<string, string | string[]>, calls: string[] = []): Generator & { calls: string[] } {
  const left: Record<string, string[]> = Object.fromEntries(Object.entries(replies).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const gen = (async (messages: ChatMessage[]) => {
    const prompt = messages[messages.length - 1].content;
    calls.push(prompt);
    const heading = /^Scene \d+ of \d+: (.*)$/m.exec(prompt)![1];
    const key = Object.keys(left).find((k) => heading.includes(k));
    const queue = key ? left[key] : undefined;
    return queue?.length ? (queue.length > 1 ? queue.shift()! : queue[0]) : '{"moment": null}';
  }) as unknown as Generator & { calls: string[] };
  gen.calls = calls;
  return gen;
}

describe('the model prompt', () => {
  it('numbers the action and dialogue lines of a passage and names the speakers', async () => {
    const p = await bare('lighthouse');
    const speakers = new Map(p.characters.map((c) => [c.id, c.displayName]));
    const lines = promptLines(p.passages[4], speakers);
    expect(lines).toEqual([
      { n: 1, index: 0, text: '[action] The iron door at the top is shut. Mira unlocks the door with the brass key.' },
      { n: 2, index: 1, text: "[TOMAS] Who's there?" },
    ]);
    const prompt = buildPrompt({ passage: p.passages[4], index: 4, total: 5, lines, knownItems: [{ id: 'brass_key', displayName: 'Brass Key', consumable: false, origin: 'generated' }] });
    expect(prompt).toBe("Scene 4 of 5: INT. LIGHTHOUSE STAIRWELL - NIGHT\n1 [action] The iron door at the top is shut. Mira unlocks the door with the brass key.\n2 [TOMAS] Who's there?\nItems the reader may already hold: Brass Key (brass_key)\nName at most one moment where the reader could choose what happens.");
    // Markup is stripped; a passage with no spoken or action lines has no prompt lines.
    expect(promptLines(p.passages[5], speakers)[1].text).toBe('[TOMAS] The storm took the lens. Ships are coming in blind.');
    expect(promptLines({ ...p.passages[0], content: [{ type: 'note', text: 'x', origin: 'source' }] }, speakers)).toEqual([]);
  });

  it('cuts a long passage into windows that keep the passage’s line numbers', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, index: i, text: `[action] ${'x'.repeat(100)}` }));
    const w = windows(lines, 350);
    expect(w.map((x) => x.map((l) => l.n))).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]);
    expect(windows([], 100)).toEqual([]);
  });

  it('reads a reply with or without prose around it, and tells “no moment” from “unreadable”', () => {
    expect(parseReply('{"moment": {"line": 1, "kind": "pickup", "item": "brass key"}}')).toEqual({ line: 1, kind: 'pickup', item: 'brass key' });
    expect(parseReply('Sure! Here it is:\n```json\n{"moment": {"line": 2, "kind": "reply", "labels": ["Only me", 7]}}\n```')).toEqual({ line: 2, kind: 'reply', labels: ['Only me', ''] });
    expect(parseReply('{"moment": null}')).toBeNull();
    expect(parseReply('I think line 1.')).toBeUndefined();
    expect(parseReply('{"moment": [1]}')).toBeUndefined();
    expect(parseReply('{"answer": 1}')).toBeUndefined();
    expect(parseReply('{"moment": {"kind": "song"}}')).toEqual({ line: Number.NaN, kind: 'song' });
    expect(MOMENT_SCHEMA.required).toEqual(['moment']);
  });

  it('cleans labels and item phrases', () => {
    expect(cleanLabel('  say nothing.  ')).toBe('Say nothing');
    expect(cleanLabel('"Only me."')).toBe('Only me');
    expect(cleanLabel('who’s there?')).toBe('Who’s there?');
    expect(cleanLabel('')).toBe('');
    const long = cleanLabel('Tell him everything about the night the lamp went out and the ships that came in blind');
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).toBe('Tell him everything about the night the lamp went out and…');
    expect(firstSentence('Only me. Go back to bed.')).toBe('Only me.');
    expect(firstSentence('No full stop')).toBe('No full stop');
    expect(itemPhrase('The Brass Key from the mantel')).toBe('brass key');
    expect(itemPhrase('a letter')).toBe('letter');
  });
});

describe('the model suggester', () => {
  const FAKE = { model: 'fake', revision: 'test' };

  it('turns the model’s moments into pending choices, and builds the gate for a found item by rule', async () => {
    const project = await bare('lighthouse');
    const gen = canned({
      "KEEPER'S COTTAGE": '{"moment": {"line": 1, "kind": "pickup", "item": "the brass key"}}',
      'LIGHTHOUSE STAIRWELL': '{"moment": {"line": 2, "kind": "reply", "labels": ["it\'s Mira.", "say nothing"]}}',
      'LIGHTHOUSE BASE': ['I think line 1.', '{"moment": null}'],
    });
    const progress: [number, number][] = [];
    const suggester = createModelSuggester({ ...FAKE, generate: gen });
    expect(suggester.id).toBe('model:fake@test');
    const proposals = await suggester.suggest(project, { onProgress: (d, t) => progress.push([d, t]) });
    // Opening, cliff path, cottage, base, stairwell can take choices; the lamp room is the ending.
    expect(progress[0]).toEqual([0, 5]);
    expect(progress.at(-1)).toEqual([5, 5]);
    expect(gen.calls).toHaveLength(6); // one retry for the base
    expect(gen.calls[4].endsWith('Reply with the JSON object only.')).toBe(true);
    // The cottage's pickup is known to later scenes.
    expect(gen.calls[5]).toContain('Items the reader may already hold: brass key (brass_key)');
    expect(proposals.map((p) => [p.kind, p.passageId, p.evidence, p.suggester])).toEqual([
      ['pickup', 'keeper_s_cottage', 0, 'model:fake@test'],
      ['reply', 'lighthouse_stairwell', 1, 'model:fake@test'],
      ['gate', 'lighthouse_base', 0, 'model:fake@test'],
    ]);
    expect(proposals[2].evidencePassageId).toBe('lighthouse_stairwell');
    expect(applyProposals(project, proposals)).toEqual([]);
    expect(project.items).toEqual([{ id: 'brass_key', displayName: 'Brass Key', consumable: false, origin: 'generated' }]);
    expect(project.passages[4].choices.map((c) => [c.text, c.target, c.review, c.suggester])).toEqual([
      ["It's Mira", 'lamp_room', 'pending', 'model:fake@test'],
      ['Say nothing', 'lamp_room', 'pending', 'model:fake@test'],
    ]);
    expect(generateInk(project).ink).not.toContain("It's Mira");
    reviewAll(project, 'approved', 'model');
    const r = processProject(project);
    expect(r.state).toBe('Succeeded');
    expect(r.generated.ink).toContain("[It's Mira]");
    expect(r.generated.ink).toContain('+ {has_brass_key} [Use the brass key]');
  });

  it('builds a gate the model names from the item list, with the way back to the model’s own pickup', async () => {
    const project = await bare('lighthouse');
    const gen = canned({
      "KEEPER'S COTTAGE": '{"moment": {"line": 1, "kind": "pickup", "item": "brass key"}}',
      'LIGHTHOUSE STAIRWELL': '{"moment": {"line": 1, "kind": "gate", "item": "brass_key"}}',
    });
    const proposals = await createModelSuggester({ ...FAKE, generate: gen }).suggest(project);
    expect(proposals.map((p) => [p.kind, p.passageId])).toEqual([['pickup', 'keeper_s_cottage'], ['gate', 'lighthouse_base']]);
    expect(proposals[1].choices).toEqual([
      { text: 'Use the brass key', target: 'lighthouse_stairwell', conditions: [{ type: 'has_item', itemId: 'brass_key' }] },
      { text: "Go back to Keeper's Cottage", target: 'keeper_s_cottage' },
    ]);
    expect(applyProposals(project, proposals)).toEqual([]);
  });

  it('is dropped by the checks when it names a wrong line or an unknown item, and gives up on an unreadable reply', async () => {
    const project = await bare('lighthouse');
    const gen = canned({
      "KEEPER'S COTTAGE": '{"moment": {"line": 9, "kind": "pickup", "item": "brass key"}}',
      'LIGHTHOUSE STAIRWELL': '{"moment": {"line": 1, "kind": "gate", "item": "silver key"}}',
      'LIGHTHOUSE BASE': 'no json here',
      'CLIFF PATH': '{"moment": {"line": 2, "kind": "reply", "labels": ["Tomas!"]}}',
    });
    const proposals = await createModelSuggester({ ...FAKE, generate: gen }).suggest(project);
    expect(proposals.map((p) => p.kind)).toEqual(['reply', 'pickup', 'gate']);
    const dropped = applyProposals(project, proposals);
    expect(dropped.map((d) => [d.code, d.details?.check])).toEqual([[SUGGESTION_DROPPED, 'shape'], [SUGGESTION_DROPPED, 'evidence'], [SUGGESTION_DROPPED, 'references']]);
    expect(dropped[2].message).toContain('item "silver_key" does not exist');
    expect(project.passages.flatMap((p) => p.choices)).toEqual([]);
    expect(project.items).toEqual([]);
  });

  it('stops when cancelled and keeps what it found', async () => {
    const project = await bare('lighthouse');
    const controller = new AbortController();
    const gen = canned({ 'CLIFF PATH': '{"moment": {"line": 2, "kind": "reply", "labels": ["Tomas!", "Keep quiet"]}}' });
    const stopAfterTwo: Generator = async (m, o) => {
      const r = await gen(m, o);
      if (gen.calls.length === 2) controller.abort();
      return r;
    };
    const proposals = await createModelSuggester({ ...FAKE, generate: stopAfterTwo }).suggest(project, { signal: controller.signal });
    expect(gen.calls).toHaveLength(2);
    expect(proposals.map((p) => p.passageId)).toEqual(['cliff_path']);
  });

  it('makes a decision set a new true/false variable the writer can use later', async () => {
    const project = await bare('motel');
    const gen = canned({ 'ROADSIDE MOTEL': '{"moment": {"line": 3, "kind": "decision", "labels": ["Answer it", "Let it ring"], "flag": "answered the phone"}}' });
    const proposals = await createModelSuggester({ ...FAKE, generate: gen }).suggest(project);
    expect(applyProposals(project, proposals)).toEqual([]);
    expect(project.variables).toEqual([{ id: 'answered_the_phone', type: 'bool', initial: false, origin: 'generated' }]);
    expect(project.passages[0].choices.map((c) => [c.text, c.effects])).toEqual([
      ['Answer it', [{ type: 'set_var', variableId: 'answered_the_phone', value: true }]],
      ['Let it ring', []],
    ]);
    reviewAll(project, 'approved');
    expect(processProject(project).generated.ink).toContain('~ answered_the_phone = true');
  });

  it('skips passages that already have choices, endings, cutscenes and Ink kept as written', async () => {
    const project = await bare('archive');
    const gen = canned({});
    expect(await createModelSuggester({ ...FAKE, generate: gen }).suggest(project)).toEqual([]);
    expect(gen.calls.map((c) => c.split('\n')[0])).toEqual(['Scene 1 of 1: Under the Floorboard']);
    const kept = (await buildStory([{ fileName: 'k.ink', text: '-> a\n=== a ===\nHi.\n-> END\n', inkMode: 'keep' }], { mode: 'adaptation' })).project;
    expect(await createModelSuggester({ ...FAKE, generate: gen }).suggest(kept)).toEqual([]);
  });
});

describe('the cheap rules', () => {
  it('question rule: a question answered by another character becomes a reply', async () => {
    const text = 'INT. ARCHIVE - NIGHT\n\nRows of shelves.\n\nTOMAS\nWho\'s there? Speak up.\n\nMIRA\nOnly me. Go back to bed.\n\nINT. HALL - NIGHT\n\nShe walks on.\n';
    const { project } = await buildStory([{ fileName: 'a.fountain', text }], { mode: 'adaptation', heuristics: false });
    const proposals = await questionSuggester.suggest(project);
    expect(proposals).toEqual([{ kind: 'reply', passageId: 'archive', evidence: 1, suggester: 'rule:question', choices: [{ text: 'Only me', target: 'hall' }, { text: 'Say nothing', target: 'hall' }] }]);
    expect(applyProposals(project, proposals)).toEqual([]);
    // The same character answering their own question is not a reply.
    const mono = (await buildStory([{ fileName: 'a.fountain', text: text.replace('MIRA\nOnly me', 'TOMAS\nOnly me') }], { mode: 'adaptation', heuristics: false })).project;
    expect(await questionSuggester.suggest(mono)).toEqual([]);
  });

  it('wider pickup rule: a phrasing ACQUIRE misses, with the gate where the item is used', async () => {
    const text = 'INT. STUDY - DAY\n\nMira slips the letter into her coat.\n\nINT. TRAIN - DAY\n\nFields pass.\n\nINT. CARRIAGE - DAY\n\nShe reads the letter twice.\n\nINT. STATION - DAY\n\nThe end of the line.\n';
    const { project } = await buildStory([{ fileName: 'a.fountain', text }], { mode: 'adaptation', heuristics: false });
    const proposals = await widerPickupSuggester.suggest(project);
    expect(proposals.map((p) => [p.kind, p.passageId, p.choices.map((c) => c.text)])).toEqual([
      ['pickup', 'study', ['Take the letter', 'Leave it']],
      ['gate', 'train', ['Use the letter', 'Go back to Study']],
    ]);
    expect(proposals.every((p) => p.suggester === 'rule:wider_pickup')).toBe(true);
    expect(cheapRules.map((s) => s.id)).toEqual(['rule:question', 'rule:wider_pickup']);
  });
});
