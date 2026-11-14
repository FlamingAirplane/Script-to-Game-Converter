import { describe, expect, it } from 'vitest';
import { gateProposals, heuristicSuggester, isModelSuggestion, pickupProposals, reviewAll } from '../src/core/adapt';
import { buildStory } from '../src/core/builder';
import { generateInk } from '../src/core/inkgen';
import type { StoryProject } from '../src/core/isr';
import { processProject } from '../src/core/pipeline';
import { applyProposals, SUGGESTION_DROPPED, type Proposal } from '../src/core/proposals';
import { SAMPLES } from '../src/samples';

// A linear three-scene story: a pickup line in the first scene, the item used in the third.
const linear = (): StoryProject => ({
  schemaVersion: '1.0',
  project: { id: 't', title: 'T', startPassage: 'a', mode: 'adaptation' },
  sources: [],
  characters: [{ id: 'mira', displayName: 'Mira', aliases: [] }, { id: 'tomas', displayName: 'Tomas', aliases: [] }],
  items: [{ id: 'lamp', displayName: 'Lamp', consumable: false, origin: 'source' }],
  variables: [{ id: 'trust', type: 'int', initial: 0, origin: 'source' }],
  passages: [
    { id: 'a', title: 'A', content: [
      { type: 'action', text: 'Mira picks up the brass key.', origin: 'source', source: { documentId: 'doc_1', line: 3 } },
      { type: 'dialogue', speakerId: 'tomas', text: "Who's there?", origin: 'source', source: { documentId: 'doc_1', line: 5 } },
      { type: 'note', text: 'a note', origin: 'source' },
    ], choices: [], divert: 'b', isEnding: false, origin: 'source', review: 'approved' },
    { id: 'b', title: 'B', content: [{ type: 'action', text: 'Waves.', origin: 'source' }], choices: [], divert: 'c', isEnding: false, origin: 'source', review: 'approved' },
    { id: 'c', title: 'C', content: [{ type: 'action', text: 'She unlocks the door with the key.', origin: 'source' }], choices: [], isEnding: true, origin: 'source', review: 'approved' },
  ],
});

const reply = (over: Partial<Proposal> = {}): Proposal => ({
  kind: 'reply',
  passageId: 'a',
  evidence: 1,
  suggester: 'model:test@1',
  choices: [{ text: 'Only me', target: 'b' }, { text: 'Say nothing', target: 'b' }],
  ...over,
});

const dropped = (ds: ReturnType<typeof applyProposals>) => ds.map((d) => [d.code, d.details?.check, d.details?.index]);

describe('applyProposals', () => {
  it('writes a passing proposal exactly as the heuristics always did, plus who suggested it and the line that prompted it', () => {
    const p = linear();
    expect(applyProposals(p, [reply()])).toEqual([]);
    expect(p.passages[0].choices).toEqual([
      { id: 'a_only_me', text: 'Only me', target: 'b', conditions: [], effects: [], once: false, origin: 'generated', review: 'pending', suggester: 'model:test@1', source: { documentId: 'doc_1', line: 5 } },
      { id: 'a_say_nothing', text: 'Say nothing', target: 'b', conditions: [], effects: [], once: false, origin: 'generated', review: 'pending', suggester: 'model:test@1', source: { documentId: 'doc_1', line: 5 } },
    ]);
    // Pending, so not in the Ink until approved.
    expect(generateInk(p).ink).not.toContain('Only me');
    reviewAll(p, 'approved');
    expect(generateInk(p).ink).toContain('[Only me]');
  });

  it('declares new items and variables with the choices, and suffixes a taken choice id', () => {
    const p = linear();
    // A choice elsewhere already uses the id the pickup would get.
    p.passages[2].choices.push({ id: 'a_take_the_brass_key', text: 'x', target: 'END', conditions: [], effects: [], once: false, origin: 'source', review: 'approved' });
    const ds = applyProposals(p, [
      { kind: 'pickup', passageId: 'a', evidence: 0, suggester: 'heuristic', newItems: [{ id: 'brass_key', displayName: 'Brass Key' }], choices: [{ text: 'Take the brass key', target: 'b', effects: [{ type: 'give_item', itemId: 'brass_key' }] }, { text: 'Leave it', target: 'b' }] },
      { kind: 'decision', passageId: 'b', evidence: 0, suggester: 'model:t@1', newVariables: [{ id: 'braved_the_waves', type: 'bool', initial: false }], choices: [{ text: 'Wade in', target: 'c', effects: [{ type: 'set_var', variableId: 'braved_the_waves', value: true }] }, { text: 'Wait for the tide', target: 'c' }] },
    ]);
    expect(ds).toEqual([]);
    expect(p.items.map((i) => i.id)).toEqual(['lamp', 'brass_key']);
    expect(p.items[1]).toEqual({ id: 'brass_key', displayName: 'Brass Key', consumable: false, origin: 'generated' });
    expect(p.variables[1]).toEqual({ id: 'braved_the_waves', type: 'bool', initial: false, origin: 'generated' });
    expect(p.passages[0].choices.map((c) => c.id)).toEqual(['a_take_the_brass_key_2', 'a_leave_it']);
    expect(p.passages[1].choices.map((c) => c.id)).toEqual(['b_wade_in', 'b_wait_for_the_tide']);
  });

  it('check 1, shape: an empty, overlong or repeated label, or a malformed proposal', () => {
    const p = linear();
    const ds = applyProposals(p, [
      reply({ choices: [{ text: '  ', target: 'b' }, { text: 'Say nothing', target: 'b' }] }),
      reply({ choices: [{ text: 'x'.repeat(61), target: 'b' }, { text: 'Say nothing', target: 'b' }] }),
      reply({ choices: [{ text: 'Only me', target: 'b' }, { text: 'only me ', target: 'b' }] }),
      reply({ kind: 'song' as never }),
      reply({ choices: [] }),
      reply({ choices: [{ text: 'Only me', target: 'b', conditions: [{ type: 'has_item' } as never] }, { text: 'Say nothing', target: 'b' }] }),
      'not a proposal' as never,
    ]);
    expect(dropped(ds)).toEqual([
      [SUGGESTION_DROPPED, 'shape', 0], [SUGGESTION_DROPPED, 'shape', 1], [SUGGESTION_DROPPED, 'shape', 2],
      [SUGGESTION_DROPPED, 'shape', 3], [SUGGESTION_DROPPED, 'shape', 4], [SUGGESTION_DROPPED, 'shape', 5], [SUGGESTION_DROPPED, 'shape', 6],
    ]);
    expect(ds[0].severity).toBe('info');
    expect(ds[0].exportBlocked).toBe(false);
    expect(ds[2].message).toContain('the same label "Only me"');
    expect(p.passages[0].choices).toEqual([]);
  });

  it('check 2, references: unknown passages, targets, items and variables, and an item declared twice', () => {
    const p = linear();
    const ds = applyProposals(p, [
      reply({ passageId: 'zz' }),
      reply({ evidencePassageId: 'zz' }),
      reply({ choices: [{ text: 'Only me', target: 'nowhere' }, { text: 'Say nothing', target: 'b' }] }),
      reply({ choices: [{ text: 'Use the key', target: 'b', conditions: [{ type: 'has_item', itemId: 'brass_key' }] }, { text: 'Say nothing', target: 'b' }] }),
      reply({ choices: [{ text: 'Brave it', target: 'b', effects: [{ type: 'set_var', variableId: 'brave', value: true }] }, { text: 'Say nothing', target: 'b' }] }),
      reply({ newItems: [{ id: 'lamp', displayName: 'Lamp' }] }),
      reply({ newItems: [{ id: '9lives', displayName: 'Nine' }] }),
      reply({ newVariables: [{ id: 'trust', type: 'bool', initial: false }] }),
    ]);
    expect(dropped(ds).map((d) => d[1])).toEqual(Array(8).fill('references'));
    expect(ds[0].message).toContain('"zz" does not exist');
    expect(ds[3].message).toContain('item "brass_key" does not exist');
  });

  it('check 3, evidence: a line out of range, or one that is not action or dialogue', () => {
    const p = linear();
    const ds = applyProposals(p, [reply({ evidence: 7 }), reply({ evidence: -1 }), reply({ evidence: 2 })]);
    expect(dropped(ds).map((d) => d[1])).toEqual(['evidence', 'evidence', 'evidence']);
    expect(ds[0].message).toContain('line 8 is not in "A"');
  });

  it('check 4, fit: a passage with choices, with no next passage, an ending, a cutscene, or Ink kept as written', () => {
    const p = linear();
    p.passages[0].choices.push({ id: 'x', text: 'x', target: 'b', conditions: [], effects: [], once: false, origin: 'source', review: 'approved' });
    p.passages[1].cutscene = true;
    expect(dropped(applyProposals(p, [reply(), reply({ passageId: 'b', evidence: 0 }), reply({ passageId: 'c', evidence: 0 })])).map((d) => d[1])).toEqual(['fit', 'fit', 'fit']);
    const q = linear();
    q.passages[0].isEnding = true;
    expect(applyProposals(q, [reply()])[0].message).toContain('is an ending');
    const r = linear();
    r.inkPassthrough = '-> END';
    expect(applyProposals(r, [reply()])[0].message).toContain('kept exactly as written');
  });

  it('check 5, one per passage: the second group for a passage is dropped, and heuristic proposals go first', () => {
    const p = linear();
    const ds = applyProposals(p, [
      reply(),
      { kind: 'pickup', passageId: 'a', evidence: 0, suggester: 'heuristic', newItems: [{ id: 'brass_key', displayName: 'Brass Key' }], choices: [{ text: 'Take the brass key', target: 'b', effects: [{ type: 'give_item', itemId: 'brass_key' }] }, { text: 'Leave it', target: 'b' }] },
    ]);
    expect(dropped(ds)).toEqual([[SUGGESTION_DROPPED, 'one_per_passage', 0]]);
    expect(p.passages[0].choices.map((c) => c.text)).toEqual(['Take the brass key', 'Leave it']);
  });

  it('check 6, completable: a group that would leave the story stuck once approved', () => {
    const p = linear();
    // Every choice conditional on an item nothing gives: ALL_CHOICES_CONDITIONAL would be new. (b has a divert
    // fallback, so the gate is to c's predecessor with the divert removed.)
    p.passages[1].divert = 'c';
    const ds = applyProposals(p, [
      { kind: 'gate', passageId: 'b', evidence: 0, evidencePassageId: 'c', suggester: 'model:t@1', choices: [{ text: 'Use the lamp', target: 'c', conditions: [{ type: 'has_item', itemId: 'lamp' }] }, { text: 'Light the lamp', target: 'c', conditions: [{ type: 'has_item', itemId: 'lamp' }] }] },
    ]);
    expect(dropped(ds)).toEqual([[SUGGESTION_DROPPED, 'completable', 0]]);
    expect(ds[0].message).toContain('item never acquired');
    expect(p.passages[1].choices).toEqual([]);
    // The same gate passes once a pickup in the same batch gives the item.
    const q = linear();
    const ok = applyProposals(q, [
      { kind: 'pickup', passageId: 'a', evidence: 0, suggester: 'model:t@1', choices: [{ text: 'Take the lamp', target: 'b', effects: [{ type: 'give_item', itemId: 'lamp' }] }, { text: 'Leave it', target: 'b' }] },
      { kind: 'gate', passageId: 'b', evidence: 0, evidencePassageId: 'c', suggester: 'model:t@1', choices: [{ text: 'Use the lamp', target: 'c', conditions: [{ type: 'has_item', itemId: 'lamp' }] }, { text: 'Go back to A', target: 'a' }] },
    ]);
    expect(ok).toEqual([]);
    expect(processProject(q).state).toBe('ReviewRequired');
    reviewAll(q, 'approved');
    expect(processProject(q).state).toBe('Succeeded');
  });

  it('does not count problems the story already had', () => {
    const p = linear();
    p.passages.push({ id: 'orphan', title: 'Orphan', content: [], choices: [], isEnding: true, origin: 'source', review: 'approved' });
    expect(applyProposals(p, [reply()])).toEqual([]);
  });
});

describe('the heuristic suggester', () => {
  it('returns today’s pickup and gate as proposals, and the project they build is unchanged', async () => {
    const s = SAMPLES.find((x) => x.id === 'lighthouse')!;
    const { project: raw } = await buildStory([{ fileName: s.fileName, text: s.text }], { mode: 'adaptation', heuristics: false });
    expect(raw.passages.flatMap((p) => p.choices)).toEqual([]);
    const proposals = await heuristicSuggester.suggest(raw);
    expect(proposals).toEqual([
      { kind: 'pickup', passageId: 'keeper_s_cottage', evidence: 0, suggester: 'heuristic', newItems: [{ id: 'brass_key', displayName: 'Brass Key' }], choices: [{ text: 'Take the brass key', target: 'lighthouse_base', effects: [{ type: 'give_item', itemId: 'brass_key' }] }, { text: 'Leave it', target: 'lighthouse_base' }] },
      { kind: 'gate', passageId: 'lighthouse_base', evidence: 0, evidencePassageId: 'lighthouse_stairwell', suggester: 'heuristic', choices: [{ text: 'Use the brass key', target: 'lighthouse_stairwell', conditions: [{ type: 'has_item', itemId: 'brass_key' }] }, { text: 'Go back to Keeper\'s Cottage', target: 'keeper_s_cottage' }] },
    ]);
    const { project, diagnostics } = await buildStory([{ fileName: s.fileName, text: s.text }], { mode: 'adaptation' });
    expect(diagnostics.filter((d) => d.code === SUGGESTION_DROPPED)).toEqual([]);
    // The ids, texts, targets, conditions and effects the heuristics have always produced.
    expect(project.items).toEqual([{ id: 'brass_key', displayName: 'Brass Key', consumable: false, origin: 'generated' }]);
    expect(project.passages.map((p) => [p.id, p.choices.map((c) => [c.id, c.text, c.target, c.conditions, c.effects, c.review, c.suggester])]).filter(([, cs]) => cs.length)).toEqual([
      ['keeper_s_cottage', [
        ['keeper_s_cottage_take_the_brass_key', 'Take the brass key', 'lighthouse_base', [], [{ type: 'give_item', itemId: 'brass_key' }], 'pending', 'heuristic'],
        ['keeper_s_cottage_leave_it', 'Leave it', 'lighthouse_base', [], [], 'pending', 'heuristic'],
      ]],
      ['lighthouse_base', [
        ['lighthouse_base_use_the_brass_key', 'Use the brass key', 'lighthouse_stairwell', [{ type: 'has_item', itemId: 'brass_key' }], [], 'pending', 'heuristic'],
        ['lighthouse_base_go_back_to_keeper_s_cottage', "Go back to Keeper's Cottage", 'keeper_s_cottage', [], [], 'pending', 'heuristic'],
      ]],
    ]);
    // The choices point at the lines that prompted them.
    expect(project.passages[2].choices[0].source).toEqual(project.passages[2].content[0].source);
    expect(project.passages[3].choices[0].source).toEqual(project.passages[4].content[0].source);
  });

  it('skips passages another suggester claimed, and the gate rule skips them too', () => {
    const p = linear();
    const claimed = new Set(['a']);
    expect(pickupProposals(p, { claimed }).proposals).toEqual([]);
    const { proposals, found } = pickupProposals(p);
    expect(proposals).toHaveLength(1);
    expect(found).toEqual([{ itemId: 'brass_key', noun: 'key', display: 'brass key', index: 0 }]);
    // b (the passage before the door) is taken, so the gate has nowhere to go.
    expect(gateProposals(p, found, new Set(['a', 'b']))).toEqual([]);
    expect(gateProposals(p, found, new Set(['a'])).map((g) => [g.passageId, g.evidencePassageId, g.evidence])).toEqual([['b', 'c', 0]]);
  });

  it('approves or rejects by scope: a model’s suggestions apart from the rest', () => {
    const p = linear();
    applyProposals(p, [
      { kind: 'pickup', passageId: 'a', evidence: 0, suggester: 'heuristic', newItems: [{ id: 'brass_key', displayName: 'Brass Key' }], choices: [{ text: 'Take the brass key', target: 'b', effects: [{ type: 'give_item', itemId: 'brass_key' }] }, { text: 'Leave it', target: 'b' }] },
      { kind: 'reply', passageId: 'b', evidence: 0, suggester: 'model:t@1', choices: [{ text: 'Wade in', target: 'c' }, { text: 'Wait', target: 'c' }] },
    ]);
    p.passages[2].content.push({ type: 'effect', effect: { type: 'give_item', itemId: 'lamp' }, origin: 'generated', review: 'pending' });
    expect(isModelSuggestion(p.passages[1].choices[0])).toBe(true);
    expect(isModelSuggestion(p.passages[0].choices[0])).toBe(false);
    reviewAll(p, 'approved', 'not_model');
    expect(p.passages[0].choices.map((c) => c.review)).toEqual(['approved', 'approved']);
    expect(p.passages[1].choices.map((c) => c.review)).toEqual(['pending', 'pending']);
    expect(p.passages[2].content.at(-1)).toMatchObject({ review: 'approved' });
    reviewAll(p, 'rejected', 'model');
    expect(p.passages[1].choices.map((c) => c.review)).toEqual(['rejected', 'rejected']);
  });
});
