import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reviewAll } from '../src/core/adapt';
import { analyze } from '../src/core/analyzer';
import { buildStory } from '../src/core/builder';
import { ADAPTERS, ExportBlockedError } from '../src/core/export';
import { conditionToInk, escapeInk, generateInk } from '../src/core/inkgen';
import { slugify, uniqueId, type StoryProject } from '../src/core/isr';
import { fountainParser } from '../src/core/parsing/fountain';
import { parseCondition, parseMarker } from '../src/core/parsing/markers';
import { detectFormat } from '../src/core/parsing/registry';
import { processProject } from '../src/core/pipeline';
import { countWords, formatMinutes, storyStats } from '../src/core/stats';
import { compileInk } from '../src/core/validate';
import { SAMPLES } from '../src/samples';

const build = async (text: string, fileName = 'x.fountain', mode: 'faithful' | 'adaptation' | 'structured' = 'faithful') =>
  buildStory([{ fileName, text }], { mode });

describe('identifiers', () => {
  it('slugifies to valid, deterministic Ink identifiers', () => {
    expect(slugify("Keeper's Cottage")).toBe('keeper_s_cottage');
    expect(slugify('2nd Floor')).toBe('s_2nd_floor');
    expect(slugify('Café Noir')).toBe('cafe_noir');
  });
  it('dedupes and avoids Ink keywords', () => {
    const taken = new Set<string>();
    expect(uniqueId('Hall', taken)).toBe('hall');
    expect(uniqueId('Hall', taken)).toBe('hall_2');
    expect(uniqueId('END', taken)).toBe('end_2');
  });
});

describe('Ink text escaping', () => {
  it('round-trips special characters through the compiler', () => {
    const tricky = ['a {b} [c] | d # e', '// not a comment', '-> not a divert', '<> glue', '* bullet', '- gather', '= knot', 'TODO: x', 'back\\slash', '~ logic'];
    const ink = `-> s\n=== s ===\n${tricky.map(escapeInk).join('\n')}\n-> END\n`;
    const r = compileInk(ink);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('markers and conditions', () => {
  it('parses gated choices with effects', () => {
    const m = parseMarker('+ {has key && not has lamp} [Open it] -> vault @take key @add trust 2');
    expect(m).toMatchObject({ type: 'choice', once: false, text: 'Open it', target: 'vault' });
    if (m?.type !== 'choice') throw new Error();
    expect(m.conditions[0].type).toBe('and');
    expect(m.effects).toEqual([{ type: 'take_item', itemId: 'key' }, { type: 'add_var', variableId: 'trust', amount: 2 }]);
  });
  it('translates condition trees to Ink', () => {
    expect(conditionToInk(parseCondition('has key and trust >= 2'))).toBe('has_key && (trust >= 2)');
    expect(conditionToInk(parseCondition('not has key'))).toBe('not has_key');
  });
});

describe('Fountain parser', () => {
  const fx = `Title: Test

INT. HOUSE - DAY

Action line with *emphasis*.

BOB (V.O.)
(quietly)
Hello there.

ALICE ^
Hi.

> FADE OUT.

/* cut this */
[[a note]]
`;
  const doc = fountainParser.parse(fx, 'd');
  it('extracts title, scene, dialogue, parenthetical, transition, notes', () => {
    const kinds = doc.blocks.map((b) => b.kind);
    expect(kinds).toContain('title');
    expect(doc.blocks.find((b) => b.kind === 'scene')).toMatchObject({ text: 'INT. HOUSE - DAY', line: 3 });
    expect(doc.blocks.find((b) => b.kind === 'dialogue')).toMatchObject({ character: 'BOB', extension: 'V.O.', parenthetical: 'quietly', text: 'Hello there.' });
    expect(doc.blocks.find((b) => b.kind === 'dialogue' && b.character === 'ALICE')).toMatchObject({ dual: true });
    expect(doc.blocks.find((b) => b.kind === 'transition')).toMatchObject({ text: 'FADE OUT.' });
    expect(doc.blocks.filter((b) => b.kind === 'note').length).toBe(2);
    expect(doc.blocks.find((b) => b.kind === 'action')).toMatchObject({ text: 'Action line with emphasis.', transformed: true });
  });
  it('detects Fountain inside .txt by content', () => {
    expect(detectFormat('script.txt', fx).format).toBe('fountain');
  });
});

describe('faithful conversion', () => {
  it('preserves every dialogue line and keeps scene order', async () => {
    const sample = SAMPLES.find((s) => s.id === 'lighthouse')!;
    const { project } = await build(sample.text, sample.fileName, 'faithful');
    const dialogue = project.passages.flatMap((p) => p.content.filter((c) => c.type === 'dialogue'));
    const cues = sample.text.match(/^\s*(MIRA|TOMAS)( \([^)]*\))?\s*$/gm)!;
    expect(dialogue.length).toBe(cues.length);
    expect(project.passages.every((p) => p.choices.length === 0)).toBe(true);
    const r = processProject(project);
    expect(r.compile.ok).toBe(true);
    expect(r.smoke?.completedRuns).toBe(r.smoke?.runs);
  });
});

describe('structured import (golden)', () => {
  it('produces stable Ink for the Locked Archive', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const a = generateInk(project).ink;
    const b = generateInk((await build(s.text, s.fileName, 'structured')).project).ink;
    expect(a).toBe(b); // determinism
    expect(a).toMatchSnapshot();
    const r = processProject(project);
    expect(r.state).toBe('Succeeded');
    expect(Object.keys(r.smoke!.endingsReached).sort()).toEqual(['archive_inside', 'outside']);
    expect(r.smoke!.gatedChoices.every((g) => g.seenEnabled > 0)).toBe(true);
  });
});

describe('adaptation mode', () => {
  it('proposes an optional pickup and a gated path, emitted only after approval', async () => {
    const s = SAMPLES.find((x) => x.id === 'lighthouse')!;
    const { project } = await build(s.text, s.fileName, 'adaptation');
    const pending = project.passages.flatMap((p) => p.choices).filter((c) => c.review === 'pending');
    expect(pending.map((c) => c.text)).toEqual(expect.arrayContaining(['Take the brass key', 'Use the brass key']));
    expect(generateInk(project).ink).not.toContain('Take the brass key');
    expect(processProject(project).state).toBe('ReviewRequired');
    reviewAll(project, 'approved');
    const r = processProject(project);
    expect(r.generated.ink).toContain('+ {has_brass_key} [Use the brass key]');
    expect(r.state).toBe('Succeeded');
  });
});

describe('analyzer', () => {
  const base = (): StoryProject => ({
    schemaVersion: '1.0',
    project: { id: 't', title: 'T', startPassage: 'a', mode: 'structured' },
    sources: [],
    characters: [],
    items: [{ id: 'key', displayName: 'Key', consumable: false, origin: 'source' }],
    variables: [],
    passages: [
      { id: 'a', title: 'A', content: [], isEnding: false, origin: 'source', review: 'approved', choices: [
        { id: 'c1', text: 'Go', target: 'missing', conditions: [], effects: [], once: false, origin: 'source', review: 'approved' },
        { id: 'c2', text: 'Unlock', target: 'b', conditions: [{ type: 'has_item', itemId: 'key' }], effects: [], once: false, origin: 'source', review: 'approved' },
      ] },
      { id: 'b', title: 'B', content: [], choices: [], isEnding: true, origin: 'source', review: 'approved' },
      { id: 'orphan', title: 'Orphan', content: [], choices: [], isEnding: true, origin: 'source', review: 'approved' },
    ],
  });
  it('reports missing targets, unreachable passages and impossible gates', () => {
    const codes = analyze(base()).diagnostics.map((d) => d.code);
    expect(codes).toContain('INK_TARGET_MISSING');
    expect(codes).toContain('UNREACHABLE_PASSAGE');
    expect(codes).toContain('ITEM_NEVER_ACQUIRED');
  });
  it('maps compiler errors back and blocks export', async () => {
    const r = processProject(base());
    expect(r.exportBlocked).toBe(true);
    await expect(ADAPTERS.unity.export(r, { engine: 'unity', projectName: 'X', engineVersion: '2022.3.62f1', integrationRef: 'upm', includeDemo: true })).rejects.toBeInstanceOf(ExportBlockedError);
  });
});

describe('Ink import', () => {
  const simple = `VAR has_k = false\nVAR trust = 0\n-> hall\n=== hall ===\nA hall. // check the lighting\nMIRA: Anyone here?\n* {has_k} [Open] -> room\n+ {trust >= 2 && not has_k} [Force it] -> room\n* [Search]\n  ~ has_k = true\n  ~ trust += 1\n  -> hall\n=== room ===\nDone.\n-> END\n`;

  it('keeps Ink exactly as written when asked, and still analyses its graph', async () => {
    const { project, diagnostics } = await buildStory([{ fileName: 'story.ink', text: simple, inkMode: 'keep' }], { mode: 'structured' });
    const r = processProject(project, diagnostics);
    expect(r.generated.ink).toBe(simple);
    expect(r.compile.ok).toBe(true);
    expect(r.analysis.graph.edges.map((e) => `${e.from}->${e.to}`)).toEqual(expect.arrayContaining(['hall->room', 'hall->hall']));
    expect(diagnostics.some((d) => d.code === 'INK_KEPT_AS_WRITTEN')).toBe(true);
  });

  it('makes plain Ink editable: items, variables, dialogue, conditions, effects and once-only choices', async () => {
    const { inkUnsupported } = await import('../src/core/parsing/ink');
    expect(inkUnsupported(simple)).toEqual([]);
    const { project } = await build(simple, 'story.ink');
    expect(project.inkPassthrough).toBeUndefined();
    expect(project.items.map((i) => i.id)).toEqual(['k']);
    expect(project.variables).toMatchObject([{ id: 'trust', initial: 0 }]);
    const hall = project.passages.find((p) => p.id === 'hall')!;
    expect(hall.content.map((c) => c.type)).toEqual(['note', 'action', 'dialogue']);
    expect(hall.choices.map((c) => [c.text, c.target, c.once])).toEqual([['Open', 'room', true], ['Force it', 'room', false], ['Search', 'hall', true]]);
    expect(hall.choices[1].conditions).toEqual([{ type: 'and', conditions: [{ type: 'compare', variableId: 'trust', op: '>=', value: 2 }, { type: 'not', condition: { type: 'has_item', itemId: 'k' } }] }]);
    expect(hall.choices[2].effects).toEqual([{ type: 'give_item', itemId: 'k' }, { type: 'add_var', variableId: 'trust', amount: 1 }]);
    // Editing now changes the story.
    hall.choices[0].text = 'Unlock it';
    expect(processProject(project).generated.ink).toContain('* {has_k} [Unlock it]');
  });

  it('brings Narrative Bridge’s own Ink back unchanged', async () => {
    const { generateInk } = await import('../src/core/inkgen');
    for (const s of SAMPLES) {
      const { project } = await build(s.text, s.fileName, s.mode);
      const ink = generateInk(project).ink;
      const { project: back } = await build(ink, 'story.ink', 'structured');
      back.project.mode = project.project.mode;
      const strip = (x: string) => x.replace(/ \(source line \d+\)/g, '');
      expect(strip(generateInk(back).ink), s.id).toBe(strip(ink));
    }
  });

  it('keeps Ink the editor can’t show as written by default, or as notes when converted anyway', async () => {
    const { inkUnsupported } = await import('../src/core/parsing/ink');
    const complex = `VAR mood = "calm"\n-> start\n=== start ===\nHi {name}! It is {~sunny|grey}.\n* Wave [] back.\n- They nod.\n-> chat ->\n+ [Leave] -> END\n=== chat ===\nChat.\n->->\n=== function f(x)\n~ return x\n`;
    expect(inkUnsupported(complex).map((f) => f.feature)).toEqual(
      expect.arrayContaining(['inline logic or alternatives ({…})', 'choice text that is also printed after choosing', 'gathers (-)', 'tunnels (->->)', 'functions']),
    );
    const kept = await build(complex, 'c.ink');
    expect(kept.project.inkPassthrough).toBe(complex);
    const edited = await buildStory([{ fileName: 'c.ink', text: complex, inkMode: 'edit' }], { mode: 'structured' });
    expect(edited.project.inkPassthrough).toBeUndefined();
    expect(edited.project.passages.flatMap((p) => p.content).filter((c) => c.type === 'unsupported').length).toBeGreaterThanOrEqual(3);
    expect(edited.diagnostics.some((d) => d.code === 'INK_CONVERTED_PARTLY')).toBe(true);
  });
});

describe('Twine import', () => {
  /** What a player experiences: titles, text, and choices by passage title. */
  const shape = (p: StoryProject) => {
    const title = (id: string) => (id === 'END' ? 'END' : p.passages.find((x) => x.id === id)?.title ?? id);
    return p.passages.map((x) => ({
      title: x.title,
      heading: x.sceneHeading ?? '',
      end: x.isEnding,
      text: x.content.filter((c) => c.type !== 'note' && c.type !== 'effect').map((c) => ('text' in c ? c.text : '')),
      choices: x.choices.filter((c) => c.review === 'approved').map((c) => `${c.text} -> ${title(c.target)}`),
    }));
  };

  it('brings Narrative Bridge’s Twine exports back: both kinds, every sample', async () => {
    const { buildTwee } = await import('../src/core/export');
    for (const s of SAMPLES)
      for (const kind of ['sugarcube', 'plain'] as const) {
        const { project } = await build(s.text, s.fileName, 'adaptation');
        reviewAll(project, 'approved');
        const { project: back, diagnostics } = await build(buildTwee(processProject(project), kind), 'story.twee', 'structured');
        expect(shape(back), `${s.id}/${kind}`).toEqual(shape(project));
        expect(diagnostics.filter((d) => d.severity === 'error' || d.severity === 'warning' || d.severity === 'review')).toEqual([]);
        if (kind === 'sugarcube') {
          const logic = (p: StoryProject) => p.passages.map((x) => x.choices.map((c) => [c.conditions, c.effects, c.once]));
          expect(logic(back), s.id).toEqual(logic(project));
          expect(back.items.map((i) => i.displayName)).toEqual(project.items.map((i) => i.displayName));
        }
      }
  });

  it('reads Harlowe and SugarCube logic, and keeps what it can’t represent as notes', async () => {
    const harlowe = `:: StoryTitle\nOrchard\n\n:: StoryData\n{"format":"Harlowe","start":"Gate"}\n\n:: Setup [startup]\n(set: $has_basket to false)(set: $apples to 0)\n\n:: Gate\nThe gate creaks. A ''bird'' calls.\n\n(set: $apples to it + 1)\n[[Go in->Trees]]\n(if: $has_basket)[ [[Leave->Home]] ]\n\n:: Trees\nTrees heavy with //red// apples. Take a [[basket->Shed]].\n(if: $apples > 2)[You have plenty.]\n[[Back->Gate]]\n\n:: Shed\n(set: $has_basket to true)\nA basket.\n[[Gate]]\n\n:: Home\nYou walk home.\n`;
    const { project, diagnostics } = await build(harlowe, 'orchard.twee', 'structured');
    expect(project.project.title).toBe('Orchard');
    expect(project.items.map((i) => i.id)).toEqual(['basket']);
    expect(project.variables).toMatchObject([{ id: 'apples', initial: 0 }]);
    const gate = project.passages.find((p) => p.title === 'Gate')!;
    expect(project.project.startPassage).toBe(gate.id);
    expect(gate.content).toMatchObject([{ type: 'action', text: 'The gate creaks. A bird calls.' }, { type: 'effect', effect: { type: 'add_var', variableId: 'apples', amount: 1 } }]);
    expect(gate.choices.map((c) => [c.text, c.conditions])).toEqual([['Go in', []], ['Leave', [{ type: 'has_item', itemId: 'basket' }]]]);
    const trees = project.passages.find((p) => p.title === 'Trees')!;
    expect(trees.content.find((c) => c.type === 'action')).toMatchObject({ text: 'Trees heavy with red apples. Take a basket.' });
    expect(trees.content.find((c) => c.type === 'unsupported')).toMatchObject({ text: '(if: $apples > 2)[You have plenty.]' });
    expect(project.passages.find((p) => p.title === 'Home')!.isEnding).toBe(true);
    expect(diagnostics.filter((d) => d.code === 'UNSUPPORTED_CONSTRUCT')).toHaveLength(1);
    expect(processProject(project).compile.ok).toBe(true);

    const sugar = `:: StoryData\n{"format":"SugarCube","start":"Platform"}\n\n:: StoryInit\n<<set $ticket to false>>\n\n:: StoryCaption\n<<print $time>>\n\n:: Platform\nCONDUCTOR: Ticket, please.\n<<if $ticket>>[[Board|Carriage][$trust += 1]]<</if>>\n<<link "Sneak aboard" "Carriage">><<set $trust to -1>><</link>>\n\n:: Carriage\nWarm.\n`;
    const s = await build(sugar, 'train.twee', 'structured');
    const platform = s.project.passages.find((p) => p.title === 'Platform')!;
    expect(platform.content).toMatchObject([{ type: 'dialogue', text: 'Ticket, please.' }]);
    expect(platform.choices.map((c) => [c.text, c.conditions, c.effects])).toEqual([
      ['Board', [{ type: 'compare', variableId: 'ticket', op: '==', value: true }], [{ type: 'add_var', variableId: 'trust', amount: 1 }]],
      ['Sneak aboard', [], [{ type: 'set_var', variableId: 'trust', value: -1 }]],
    ]);
    expect(s.diagnostics.some((d) => d.code === 'TWINE_CODE_SKIPPED' && /StoryCaption/.test(d.message))).toBe(true);
  });

  it('reads Twine’s published HTML and library archives', async () => {
    const { prepareInput } = await import('../src/core/parsing/convert');
    const story = (name: string, pid: string) =>
      `<tw-storydata name="${name}" startnode="${pid}" format="Harlowe" ifid="X"><style role="stylesheet">a{}</style><tw-passagedata pid="1" name="Ending &amp; After" position="400,100">It&#39;s over.</tw-passagedata><tw-passagedata pid="2" name="Beginning">Once &lt;upon&gt; a time.\n[[Next-&gt;Ending &amp; After]]</tw-passagedata></tw-storydata>`;
    const input = await prepareInput('tale.html', `<html><body>${story('Tiny Tale', '2')}</body></html>`);
    expect(input).toMatchObject({ format: 'twee', convertedFrom: 'twine' });
    const { project } = await buildStory([input], { mode: 'structured' });
    expect(project.project.title).toBe('Tiny Tale');
    const start = project.passages.find((p) => p.id === project.project.startPassage)!;
    expect(start.title).toBe('Beginning');
    expect(start.content).toMatchObject([{ text: 'Once <upon> a time.' }]);
    expect(start.choices.map((c) => [c.text, project.passages.find((p) => p.id === c.target)?.title])).toEqual([['Next', 'Ending & After']]);
    const archive = await prepareInput('library.html', `${story('One', '2')}${story('Two', '2')}`);
    const built = await buildStory([archive], { mode: 'structured' });
    expect(built.diagnostics.some((d) => d.code === 'INPUT_NOTE' && /2 Twine stories/.test(d.message))).toBe(true);
    await expect(prepareInput('page.html', '<html><body>Hello</body></html>')).rejects.toThrow(/not a Twine story/);
  });
});

describe('story logic expressions', () => {
  it('reads Ink, SugarCube and Harlowe conditions and assignments, and refuses what it can’t represent', async () => {
    const { parseConditionExpr, parseAssignment } = await import('../src/core/parsing/expr');
    expect(parseConditionExpr('has_key && (trust >= 2)')).toEqual({ type: 'and', conditions: [{ type: 'has_item', itemId: 'key' }, { type: 'compare', variableId: 'trust', op: '>=', value: 2 }] });
    expect(parseConditionExpr('$has_key and $trust gte 2')).toEqual(parseConditionExpr('has_key && trust >= 2'));
    expect(parseConditionExpr('not $has_key or $mood is not "calm"')).toEqual({ type: 'or', conditions: [{ type: 'not', condition: { type: 'has_item', itemId: 'key' } }, { type: 'compare', variableId: 'mood', op: '!=', value: 'calm' }] });
    expect(parseConditionExpr('$has_key is false')).toEqual({ type: 'not', condition: { type: 'has_item', itemId: 'key' } });
    expect(parseConditionExpr('2 < $trust')).toEqual({ type: 'compare', variableId: 'trust', op: '>', value: 2 });
    for (const bad of ['$a + 1 > 2', 'random(1, 6) > 3', '_temp', '$a >', '']) expect(parseConditionExpr(bad), bad).toBeNull();
    expect(parseAssignment('has_key = true')).toEqual({ type: 'give_item', itemId: 'key' });
    expect(parseAssignment('$has_key to false')).toEqual({ type: 'take_item', itemId: 'key' });
    expect(parseAssignment('$apples to it + 2')).toEqual({ type: 'add_var', variableId: 'apples', amount: 2 });
    expect(parseAssignment('$apples to $apples - 1')).toEqual({ type: 'add_var', variableId: 'apples', amount: -1 });
    expect(parseAssignment('trust--')).toEqual({ type: 'add_var', variableId: 'trust', amount: -1 });
    expect(parseAssignment('$name to "Mira"')).toEqual({ type: 'set_var', variableId: 'name', value: 'Mira' });
    expect(parseAssignment('$x to random(1, 6)')).toBeNull();
  });
});

describe('engine exports', () => {
  for (const engine of ['unity', 'unreal'] as const) {
    it(`builds a verified ${engine} package`, async () => {
      const s = SAMPLES.find((x) => x.id === 'archive')!;
      const { project } = await build(s.text, s.fileName, 'structured');
      const story = processProject(project);
      const adapter = ADAPTERS[engine];
      const res = await adapter.export(story, { engine, projectName: 'Locked Archive', engineVersion: adapter.defaultEngineVersion, integrationRef: 'v1.2.3', includeDemo: true });
      expect(res.report.errors).toEqual([]);
      expect(res.manifest.validation.exportVerification).toBe('passed');
      expect(res.manifest.integration.pinned).toBe(true);
      const ink = res.files.find((f) => f.path.endsWith('MainStory.ink'))!;
      expect(ink.content).toBe(story.generated.ink);
      const manifest = JSON.parse(res.files.find((f) => f.path.endsWith('narrative-bridge.manifest.json'))!.content as string);
      expect(manifest.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(manifest.validation.engineSmokeTest).toBe('pending');
    });
  }
  it('Unity saves record the choices made, so they carry over to a revised story (C# strings stay escaped)', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const res = await ADAPTERS.unity.export(processProject(project), { engine: 'unity', projectName: 'Locked Archive', engineVersion: ADAPTERS.unity.defaultEngineVersion, integrationRef: 'v1.2.3', includeDemo: true });
    const file = (name: string) => res.files.find((f) => f.path.endsWith(name))!.content as string;
    const controller = file('NarrativeController.cs');
    expect(controller).toContain('choicePath.Add(Story.currentChoices[index].text);');
    expect(controller).toContain('saveJson.IndexOf("\\"choicePath\\"", StringComparison.Ordinal)');
    expect(file('NarrativeBridgeEditor.cs')).toContain('save.Replace("\\"storyVersion\\":\\"" + StoryInfo.StoryVersion');
  });
});

describe('hashing', () => {
  it('pure SHA-256 matches Web Crypto (used when opened from file://)', async () => {
    const { sha256 } = await import('../src/core/hash');
    for (const text of ['', 'abc', 'Café ☕ '.repeat(40), 'x'.repeat(1000)]) {
      const data = new TextEncoder().encode(text);
      const expected = Buffer.from(await crypto.subtle.digest('SHA-256', data)).toString('hex');
      expect(Buffer.from(sha256(data)).toString('hex')).toBe(expected);
    }
  });
});

describe('share exports', () => {
  const runtime = 'window.inkjs = {};';
  it('playable HTML embeds the story safely, even with </script> in the text', async () => {
    const { buildPlayableHtml } = await import('../src/core/export');
    const text = '@passage start Start\nShe wrote </script><!-- on the wall.\n@end\n';
    const { project } = await build(text, 'x.md', 'structured');
    const html = buildPlayableHtml(processProject(project), runtime);
    const json = /<script id="story-json" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1];
    expect(json).not.toMatch(/<\/script|<!--/i);
    expect(JSON.stringify(JSON.parse(json))).toContain('</script><!--');
    expect(html.match(/<script/g)!.length).toBe(5);
  });

  /** Passages of a Twee file by name, and the targets of every [[link]] in them. */
  const parseTwee = (twee: string) => {
    const passages = new Map<string, string>();
    for (const m of twee.matchAll(/^:: ([^\n[{]+?)\s*(?:\[[^\]]*\])?\s*(?:\{[^\n]*\})?\n([\s\S]*?)(?=\n:: |$)/gm)) passages.set(m[1].trim(), m[2]);
    const targets = [...twee.matchAll(/\[\[[^\]]*?->([^\]]+)\](?:\[[^\]]*\])?\]/g)].map((m) => m[1]);
    return { passages, targets };
  };

  it('Twine export (SugarCube) reads as plain prose and keeps the story logic', async () => {
    const { buildTwee } = await import('../src/core/export');
    const { ifidFor } = await import('../src/core/export/twine');
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const twee = buildTwee(processProject(project));
    expect(twee).toContain('"start": "Archive Entrance"');
    expect(twee).toContain('<<set $has_archive_key to false>>');
    expect(twee).toContain('<<if $has_archive_key>>[[Open the archive->The Vault][$has_archive_key to false]]<</if>>');
    expect(twee).toContain('<<if not $has_archive_key>>[[Lift the loose floorboard->Under the Floorboard]]<</if>>');
    expect(twee).toContain(':: The Vault [ending]');
    // Readable in Twine's editor: no HTML, no verbatim wrapping of ordinary text, paragraphs apart.
    expect(twee).not.toMatch(/<span|"""/);
    expect(twee).toContain('Rows of shelves vanish into the dark. A steel door blocks the inner vault.\n\n@@.speaker;MIRA@@\nThe archive is locked.');
    // Effects leave no empty line behind.
    expect(twee).toContain('<<set $has_archive_key to true>>\\\n[[Continue->Reading Room]]');
    // Hidden choices sit in a block whose stray line breaks the stylesheet removes.
    expect(twee).toMatch(/@@\.choices;\n<<if \$has_archive_key>>/);
    const { passages, targets } = parseTwee(twee);
    expect(targets.length).toBeGreaterThan(4);
    for (const t of targets) expect(passages.has(t), t).toBe(true);
    for (const body of passages.values()) {
      expect((body.match(/<<if /g) ?? []).length).toBe((body.match(/<<\/if>>/g) ?? []).length);
      expect((body.match(/@@/g) ?? []).length % 2).toBe(0);
    }
    expect(ifidFor('x')).toBe(ifidFor('x'));
    expect(ifidFor('x')).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  });

  it('Twine export (story only) has just passages, text and links', async () => {
    const { buildTwee, twineFileName } = await import('../src/core/export');
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const story = processProject(project);
    const twee = buildTwee(story, 'plain');
    expect(twineFileName(story, 'plain')).toBe('the_locked_archive-story-only.twee');
    expect(twee).not.toMatch(/<<|@@|\$|\/\*|StoryInit|Stylesheet|"format"|\[ending\]/);
    expect(twee).toContain('MIRA: The archive is locked.');
    // Every choice is offered (conditions are part of the game logic, which is left out).
    expect(twee).toContain('[[Open the archive->The Vault]]\n[[Search the reading room->Reading Room]]\n[[Leave->Outside]]');
    const { passages, targets } = parseTwee(twee);
    expect(targets.length).toBeGreaterThan(4);
    for (const t of targets) expect(passages.has(t), t).toBe(true);
    // Its own IFID, so Twine keeps it beside the full version.
    const ifid = (t: string) => /"ifid": "([^"]+)"/.exec(t)![1];
    expect(ifid(twee)).not.toBe(ifid(buildTwee(story)));
  });

  it('Twine export escapes only text SugarCube would misread, and lays passages out like the story map', async () => {
    const { buildTwee } = await import('../src/core/export');
    const { project } = await build('@passage a Start\nPrices: $money and [[not a link]] here.\n\nPlain line.\n-> b\n@passage b Next\nThe end.\n@end\n', 'x.md', 'structured');
    const twee = buildTwee(processProject(project));
    expect(twee).toContain('"""Prices: $money and [[not a link]] here."""');
    expect(twee).toContain('\nPlain line.\n');
    expect(twee).toContain('\nThe end.\n');
    const pos = (name: string) => JSON.parse(new RegExp(`:: ${name}[^\\n]*?(\\{.*\\})`).exec(twee)![1]).position.split(',').map(Number);
    expect(pos('Start')[0]).toBeLessThan(pos('Next')[0]);
  });

  it('Twine export refuses Ink passthrough projects', async () => {
    const { buildTwee, ExportBlockedError } = await import('../src/core/export');
    const { project, diagnostics } = await buildStory([{ fileName: 'a.ink', text: '-> a\n=== a ===\nHi\n-> END\n', inkMode: 'keep' }], { mode: 'structured' });
    expect(() => buildTwee(processProject(project, diagnostics))).toThrow(ExportBlockedError);
  });
});

describe('Final Draft and Word import', () => {
  const docx = async (paragraphs: [string, string][]) => {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const p = (style: string, text: string) =>
      `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${paragraphs.map(([s, t]) => p(s, t)).join('')}</w:body></w:document>`);
    zip.file('word/styles.xml', `<w:styles><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`);
    return zip.generateAsync({ type: 'uint8array' });
  };

  it('converts an FDX screenplay, keeping every line, dual dialogue and the title page', async () => {
    const { prepareInput } = await import('../src/core/parsing/convert');
    const input = await prepareInput('archive.fdx', readFileSync('tests/fixtures/archive.fdx', 'utf8'));
    expect(input.format).toBe('fountain');
    expect(input.text).toMatch(/^Title: The Locked Archive\nAuthor: A. Writer/);
    const { project, diagnostics } = await buildStory([input], { mode: 'faithful' });
    expect(diagnostics.map((d) => d.code)).toContain('INPUT_CONVERTED');
    expect(project.project.title).toBe('The Locked Archive');
    expect(project.passages.map((p) => p.sceneHeading)).toEqual(['INT. ARCHIVE - NIGHT', 'EXT. CLIFF PATH - DAWN']);
    const blocks = project.passages[0].content;
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'action', text: 'Rows of shelves vanish into the dark. MIRA lifts a lantern & squints.' }));
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'dialogue', parenthetical: 'whispering', text: 'The archive is locked. “Again.”' }));
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'action', text: 'THE DOOR CREAKS.' })); // caps action stays action
    expect(blocks.filter((b) => b.type === 'dialogue')).toHaveLength(3);
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'transition', text: 'CUT TO:' }));
    expect(project.characters.map((c) => c.displayName).sort()).toEqual(['MIRA', 'TOMAS']);
    expect(processProject(project).compile.ok).toBe(true);
  });

  it('rejects files that are not Final Draft XML', async () => {
    const { prepareInput } = await import('../src/core/parsing/convert');
    await expect(prepareInput('x.fdx', '<html></html>')).rejects.toThrow(/not a Final Draft/);
  });

  it('converts a Word screenplay that uses screenplay styles', async () => {
    const { prepareInput } = await import('../src/core/parsing/convert');
    const bytes = await docx([
      ['SceneHeading', 'INT. LIGHTHOUSE - NIGHT'],
      ['Action', 'The lamp is dark.'],
      ['Character', 'TOMAS'],
      ['Parenthetical', 'weakly'],
      ['Dialogue', 'The lens is gone.'],
      ['Transition', 'FADE OUT.'],
    ]);
    const input = await prepareInput('script.docx', bytes);
    expect(input.format).toBe('fountain');
    const { project } = await buildStory([input], { mode: 'faithful' });
    expect(project.passages[0].sceneHeading).toBe('INT. LIGHTHOUSE - NIGHT');
    expect(project.passages[0].content).toContainEqual(expect.objectContaining({ type: 'dialogue', parenthetical: 'weakly', text: 'The lens is gone.' }));
    expect(project.passages[0].content).toContainEqual(expect.objectContaining({ type: 'transition', text: 'FADE OUT.' }));
  });

  it('converts a Word prose document with headings into passages', async () => {
    const { prepareInput } = await import('../src/core/parsing/convert');
    const bytes = await docx([
      ['Heading1', 'The Long Road'],
      ['Heading2', 'Morning'],
      ['', 'The sun came up over the hills.'],
      ['Heading2', 'Evening'],
      ['', '# not a heading, just text'],
    ]);
    const input = await prepareInput('novel.docx', bytes);
    expect(input.format).toBe('md');
    const { project } = await buildStory([input], { mode: 'faithful' });
    expect(project.project.title).toBe('The Long Road');
    expect(project.passages.map((p) => p.title)).toEqual(['Morning', 'Evening']);
    expect(project.passages[1].content[0]).toMatchObject({ type: 'action', text: '# not a heading, just text' });
  });
});

describe('background processing', () => {
  it('the fast pass (skipSmoke) matches the full pass once playthroughs are attached', async () => {
    const { attachSmoke } = await import('../src/core/pipeline');
    const { smokeTestAsync } = await import('../src/core/validate');
    for (const s of SAMPLES) {
      const { project, diagnostics } = await build(s.text, s.fileName, s.mode);
      const full = processProject(project, diagnostics);
      const quick = processProject(project, diagnostics, { skipSmoke: true });
      expect(quick.compile.ok).toBe(true);
      expect(quick.smokePending).toBe(true);
      expect(quick.diagnostics.filter((d) => d.exportBlocked)).toEqual([]);
      const r = await smokeTestAsync(quick.compile.json!, project, { shouldContinue: () => true });
      const merged = attachSmoke(quick, r!);
      expect(merged.state).toBe(full.state);
      expect(merged.smoke).toEqual(full.smoke);
      expect(merged.diagnostics.map((d) => d.code)).toEqual(full.diagnostics.map((d) => d.code));
    }
  });

  it('cancels playthroughs when a newer edit arrives', async () => {
    const { smokeTestAsync } = await import('../src/core/validate');
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const quick = processProject(project, [], { skipSmoke: true });
    const r = await smokeTestAsync(quick.compile.json!, project, { shouldContinue: () => false, sliceMs: 0 });
    expect(r).toBeNull();
  });

  it('a linear story needs only one playthrough', () => {
    const s = SAMPLES.find((x) => x.id === 'motel')!;
    return build(s.text, s.fileName, 'faithful').then(({ project }) => {
      const r = processProject(project);
      expect(r.smoke).toMatchObject({ runs: 1, completedRuns: 1, stopReason: 'deterministic' });
    });
  });
});

describe('review tools', () => {
  it('finds and replaces across titles, text, parentheticals and choices', async () => {
    const { findText, replaceText } = await import('../src/ui/projectOps');
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const hits = findText(project, 'archive');
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(hits.some((h) => h.where === 'choice')).toBe(true);
    expect(findText(project, 'ARCHIVE', true)).toHaveLength(0);
    const n = replaceText(project, 'archive', 'library');
    expect(n).toBe(hits.length);
    expect(findText(project, 'archive')).toHaveLength(0);
    expect(project.passages.find((p) => p.id === 'archive_entry')!.choices[0]).toMatchObject({ text: 'Open the library', origin: 'user_authored' });
    expect(processProject(project).compile.ok).toBe(true); // ids are untouched
  });

  it('merges a duplicate character into another', async () => {
    const { mergeCharacter } = await import('../src/ui/projectOps');
    const { project } = await build('INT. A - DAY\n\nMIRA\nHi.\n\nMIRA (V.O.)\nStill me.\n\nMIRA K.\nAnd me.\n', 'x.fountain');
    const k = project.characters.find((c) => c.displayName === 'MIRA K.')!;
    const mira = project.characters.find((c) => c.displayName === 'MIRA')!;
    expect(mergeCharacter(project, k.id, mira.id)).toBe(1);
    expect(project.characters.map((c) => c.displayName)).toEqual(['MIRA']);
    expect(mira.aliases).toContain('MIRA K.');
    expect(project.passages[0].content.filter((b) => b.type === 'dialogue').every((b) => b.type === 'dialogue' && b.speakerId === mira.id)).toBe(true);
  });

  it('reorders passages without changing the story flow', async () => {
    const { movePassage } = await import('../src/ui/projectOps');
    const s = SAMPLES.find((x) => x.id === 'motel')!;
    const { project } = await build(s.text, s.fileName);
    const before = processProject(project).smoke!.endingsReached;
    expect(movePassage(project, 'parking_lot', -1)).toBe(true);
    expect(project.passages.map((p) => p.id)).toEqual(['roadside_motel', 'parking_lot', 'motel_office']);
    expect(movePassage(project, 'roadside_motel', -1)).toBe(false);
    expect(processProject(project).smoke!.endingsReached).toEqual(before);
  });
});

describe('dialogue audio', () => {
  const withClip = async () => {
    const { project } = await build(SAMPLES.find((x) => x.id === 'archive')!.text, 'a.md', 'structured');
    const line = project.passages[0].content.find((b) => b.type === 'dialogue')!;
    if (line.type !== 'dialogue') throw new Error();
    line.audio = { id: 'vo_mira_1', name: 'take1.wav', mime: 'audio/wav', durationMs: 1200 };
    project.characters[0].voice = { voiceName: 'Samantha', rate: 1.2, pitch: 0.75 };
    return processProject(project);
  };

  it('encodes a valid mono 16-bit WAV', async () => {
    const { encodeWav } = await import('../src/core/audio');
    const wav = encodeWav([new Float32Array([0, 0.5, -0.5, 1]), new Float32Array([0, 0.5, -0.5, -1])], 22050);
    const v = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getUint32(40, true)).toBe(8); // 4 samples × 2 bytes
    expect(v.getInt16(46, true)).toBe(Math.round(0.5 * 0x7fff)); // averaged channels
    expect(v.getInt16(50, true)).toBe(0); // 1 and -1 mixed to silence
  });

  it('tags clipped lines in Ink and ships the clip with every export', async () => {
    const story = await withClip();
    expect(story.generated.ink).toContain('#audio:vo_mira_1.wav');
    expect(story.compile.ok).toBe(true);
    const bytes = new Uint8Array([82, 73, 70, 70]);
    const audio = { vo_mira_1: { mime: 'audio/wav', bytes } };
    for (const engine of ['unity', 'unreal'] as const) {
      const a = ADAPTERS[engine];
      const r = await a.export(story, { engine, projectName: 'A', engineVersion: a.defaultEngineVersion, integrationRef: 'v1.0.0', includeDemo: true, audio });
      const clip = r.files.find((f) => f.path.endsWith('vo_mira_1.wav'))!;
      expect(clip.content).toBe(bytes);
      expect(clip.path).toContain(engine === 'unity' ? 'Resources/NarrativeBridgeAudio/' : 'StorySource/VoiceClips/');
      expect(r.report.errors).toEqual([]);
    }
    const missing = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'A', engineVersion: '6000.0', integrationRef: 'v1.0.0', includeDemo: true });
    expect(missing.report.warnings.join(' ')).toContain('take1.wav');
    const { buildPlayableHtml } = await import('../src/core/export');
    const html = buildPlayableHtml(story, 'window.inkjs={};', audio);
    expect(html).toContain('"vo_mira_1.wav":"data:audio/wav;base64,UklGRg=="');
    expect(html).toContain('"voiceName":"Samantha"');
  });
});

describe('recording script', () => {
  it('lists every line of dialogue with character, direction and clip file, CSV-escaped', async () => {
    const { buildRecordingScript } = await import('../src/core/export');
    const { project } = await build('INT. A - DAY\n\nMIRA\n(quietly)\nHello, "friend".\n\nTOMAS\nHi.\n', 'x.fountain');
    const line = project.passages[0].content.find((b) => b.type === 'dialogue')!;
    if (line.type === 'dialogue') line.audio = { id: 'vo_x', name: 't.wav', mime: 'audio/wav' };
    const csv = buildRecordingScript(project);
    const rows = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(rows[0]).toBe('#,Passage,Character,Direction,Line,Clip,Recorded');
    expect(rows[1]).toBe('1,A,MIRA,quietly,"Hello, ""friend"".",vo_x.wav,yes');
    expect(rows[2]).toBe('2,A,TOMAS,,Hi.,a_002.wav,');
  });
});

describe('logging', () => {
  it('records levels, scopes and timings in a bounded buffer', async () => {
    const { log, logbook, formatEntry } = await import('../src/core/log');
    logbook.consoleLevel = 'off';
    logbook.clear();
    const l = log('test');
    l.debug('quiet detail', { n: 1 });
    l.warn('something odd');
    const done = l.time('timed step', 'info');
    const ms = done({ items: 3 });
    const mine = logbook.all().filter((e) => e.scope === 'test');
    expect(mine.map((e) => e.level)).toEqual(['debug', 'warn', 'info']);
    expect(mine[2]).toMatchObject({ msg: 'timed step', data: { items: 3 }, ms });
    expect(formatEntry(mine[2])).toMatch(/INFO .* test: timed step \(\d+(\.\d)? ms\) \{"items":3\}/);
    for (let i = 0; i < 1200; i++) l.debug('flood');
    expect(logbook.all().length).toBe(1000);
  });

  it('logs every pipeline stage without any story text', async () => {
    const { logbook } = await import('../src/core/log');
    logbook.consoleLevel = 'off';
    logbook.clear();
    const secret = 'The cipher is VELVET-ORCHID-7731';
    const { project, diagnostics } = await build(`INT. VAULT - NIGHT\n\nMIRA\n${secret}\n\nShe whispers the phrase again.\n`, 'secret.fountain');
    processProject(project, diagnostics);
    const entries = logbook.all();
    const msgs = entries.map((e) => e.msg);
    for (const m of ['Parsed document', 'Built story', 'Analysed story graph', 'Generated Ink', 'Compiled Ink', 'Ran automated playthroughs', 'Processed story'])
      expect(msgs).toContain(m);
    const dump = JSON.stringify(entries);
    expect(dump).not.toContain('VELVET');
    expect(dump).not.toContain('whispers');
    expect(entries.find((e) => e.msg === 'Compiled Ink')?.ms).toBeGreaterThanOrEqual(0);
  });
});

describe('story statistics', () => {
  it('counts words, choices, endings and lines per character, skipping rejected proposals', async () => {
    expect(countWords("Don't move — the keeper's lamp is lit, 3 times.")).toBe(9);
    const { project } = await build(SAMPLES[0].text, SAMPLES[0].fileName, 'structured');
    const st = storyStats(project);
    expect(st.passages).toBe(project.passages.length);
    expect(st.endings).toBeGreaterThan(0);
    expect(st.choices).toBe(project.passages.flatMap((p) => p.choices).length);
    expect(st.characters.reduce((n, c) => n + c.lines, 0)).toBe(project.passages.flatMap((p) => p.content).filter((b) => b.type === 'dialogue').length);
    expect(st.words).toBeGreaterThan(st.dialogueWords);
    // A rejected passage drops out of every count.
    const lines = st.characters.reduce((n, c) => n + c.lines, 0);
    const withDialogue = project.passages.find((p) => p.content.some((b) => b.type === 'dialogue'))!;
    withDialogue.review = 'rejected';
    const after = storyStats(project);
    expect(after.passages).toBe(st.passages - 1);
    expect(after.characters.reduce((n, c) => n + c.lines, 0)).toBeLessThan(lines);
  });
  it('formats durations for writers', () => {
    expect(formatMinutes(0.4)).toBe('under a minute');
    expect(formatMinutes(1.2)).toBe('about 1 minute');
    expect(formatMinutes(80)).toBe('about 1 hour 20 minutes');
    expect(formatMinutes(120)).toBe('about 2 hours');
  });
});

describe('PDF import', () => {
  const at = (page: number, x: number, y: number, text: string, size = 12) => ({ page, x, y, size, text });
  it('rebuilds screenplay structure from indents and drops page furniture', async () => {
    const { pdfLinesToText } = await import('../src/core/parsing/pdf');
    const m = 108; // 1.5" action margin
    const lines = [
      at(1, 300, 300, 'NIGHT SHIFT', 24),
      at(1, 290, 340, 'by'),
      at(1, 280, 360, 'Sam Doe'),
      at(2, 526, 40, '2.'),
      at(2, 72, 80, '4'),
      at(2, m, 80, '4 INT. DINER - NIGHT 4'),
      at(2, m, 104, 'A neon sign buzzes over an empty'),
      at(2, m, 116, 'counter.'),
      at(2, m + 158, 140, 'JO'),
      at(2, m + 115, 152, '(quietly)'),
      at(2, m + 72, 164, 'Coffee. Black. And whatever'),
      at(2, m + 158, 700, '(MORE)'),
      at(3, 526, 40, '3.'),
      at(3, m + 158, 80, "JO (CONT'D)"),
      at(3, m + 72, 92, 'you have that still counts as pie.'),
      at(3, m + 158, 116, 'COOK (O.S.)'),
      at(3, m + 72, 128, 'Kitchen closed an hour ago.'),
      at(3, m + 158, 152, 'JO'),
      at(3, m + 72, 164, 'Then open it.'),
      at(3, 432, 200, 'SMASH CUT TO:'),
      at(3, m, 224, 'EXT. PARKING LOT - LATER'),
    ];
    const { text, format } = pdfLinesToText(lines);
    expect(format).toBe('fountain');
    expect(text).toBe(
      [
        'Title: NIGHT SHIFT',
        'Author: Sam Doe',
        '',
        'INT. DINER - NIGHT',
        '',
        'A neon sign buzzes over an empty counter.',
        '',
        '@JO',
        '(quietly)',
        'Coffee. Black. And whatever',
        '',
        '@JO',
        'you have that still counts as pie.',
        '',
        '@COOK (O.S.)',
        'Kitchen closed an hour ago.',
        '',
        '@JO',
        'Then open it.',
        '',
        '> SMASH CUT TO:',
        '',
        'EXT. PARKING LOT - LATER',
        '',
      ].join('\n'),
    );
  });
  it('imports a screenplay PDF with every line of dialogue, and a novel PDF by chapter', async () => {
    const { prepareInput } = await import('../src/core/parsing/convert');
    const script = await prepareInput('lighthouse.pdf', new Uint8Array(readFileSync('tests/fixtures/lighthouse.pdf')));
    expect(script).toMatchObject({ format: 'fountain', convertedFrom: 'pdf' });
    const { project, diagnostics } = await buildStory([script], { mode: 'faithful' });
    expect(project.project.title).toBe('THE LIGHTHOUSE KEEPER');
    expect(project.characters.map((c) => c.displayName).sort()).toEqual(['KEEPER', 'MARA']);
    expect(project.passages.map((p) => p.sceneHeading)).toEqual(['EXT. LIGHTHOUSE - NIGHT', 'INT. LAMP ROOM - CONTINUOUS']);
    const dialogue = project.passages.flatMap((p) => p.content).filter((b) => b.type === 'dialogue');
    expect(dialogue.map((b) => b.type === 'dialogue' && b.text)).toEqual([
      'Is anyone up there? The light has gone out and the boats are still at sea, every one of them.',
      'Go home, Mara.',
      'Forty years I kept it lit.',
      'Then keep it lit tonight.',
      'Hand me the oil.',
    ]);
    expect(diagnostics.some((d) => d.code === 'INPUT_CONVERTED' && /from PDF/.test(d.message))).toBe(true);

    const novel = await prepareInput('novel.pdf', new Uint8Array(readFileSync('tests/fixtures/novel.pdf')));
    expect(novel.format).toBe('md');
    const story = await buildStory([novel], { mode: 'faithful' });
    expect(story.project.passages.map((p) => p.title)).toEqual(['Chapter One', 'Chapter Two']);
    // Paragraphs that run onto the next page stay whole.
    expect(novel.text).not.toMatch(/\n\n(?!#|The keeper|Mara|The lamp)/);
  });
  it('explains files that are not readable PDFs', async () => {
    const { prepareInput } = await import('../src/core/parsing/convert');
    await expect(prepareInput('x.pdf', new TextEncoder().encode('not a pdf'))).rejects.toThrow(/could not be read as a PDF/);
  });
});

describe('Continue breaks', () => {
  const src = `@item key "Key"\n@passage hall Hall\nThe hall is dark.\n@pause\nA light flickers.\n@give key\n@pause\nMIRA: Who's there?\n* {has key} [Unlock] -> room\n+ [Wait] -> hall\n@passage room Room\nInside.\n@pause\nThe end comes quietly.\n@end\n`;
  const kinds = (p: StoryProject) => p.passages.map((x) => x.content.map((b) => b.type).join(','));

  it('@pause becomes a break that every Ink player shows as Continue, and plays through', async () => {
    const { project } = await build(src, 's.md', 'structured');
    expect(kinds(project)).toEqual(['action,pause,action,effect,pause,dialogue', 'action,pause,action']);
    const story = processProject(project);
    expect(story.generated.ink).toContain('The hall is dark.\n+ [Continue]\n-\nA light flickers.');
    expect(story.compile.ok).toBe(true);
    expect(story.smoke?.endingsReached).toMatchObject({ room: expect.any(Number) });
    // A linear story with breaks is still one playthrough.
    const linear = processProject((await build('@passage a A\nOne.\n@pause\nTwo.\n@end\n', 'l.md', 'structured')).project);
    expect([linear.smoke?.stopReason, linear.smoke?.runs]).toEqual(['deterministic', 1]);
  });

  it('round-trips through Ink exactly, and only the exact form counts as a break', async () => {
    const { inkUnsupported } = await import('../src/core/parsing/ink');
    const { project } = await build(src, 's.md', 'structured');
    const ink = generateInk(project).ink;
    expect(inkUnsupported(ink)).toEqual([]);
    const back = (await build(ink, 's.ink', 'structured')).project;
    expect(back.inkPassthrough).toBeUndefined();
    back.project.mode = project.project.mode;
    const strip = (x: string) => x.replace(/ \(source line \d+\)/g, '');
    expect(strip(generateInk(back).ink)).toBe(strip(ink));
    // Hand-written Ink: a Continue inside an open set of choices is a choice, followed by a real gather.
    expect(inkUnsupported('=== a ===\nHi\n* [A] -> a\n+ [Continue]\n-\nAfter\n-> END\n').map((f) => f.feature)).toEqual(['gathers (-)']);
    expect(kinds((await build('=== a ===\nHi\n+ [Continue]\n-\nAfter\n-> END\n', 'h.ink', 'structured')).project)).toEqual(['action,pause,action']);
  });

  it('round-trips through both Twine kinds as "Name (continued)" parts', async () => {
    const { buildTwee } = await import('../src/core/export');
    const { project } = await build(src, 's.md', 'structured');
    const shape = (p: StoryProject) => p.passages.map((x) => [x.title, x.isEnding, x.content.filter((b) => b.type !== 'effect').map((b) => (b.type === 'pause' ? '⏸' : 'text' in b ? b.text : '')), x.choices.map((c) => c.text)]);
    for (const kind of ['sugarcube', 'plain'] as const) {
      const twee = buildTwee(processProject(project), kind);
      expect(twee).toContain(':: Hall (continued 2)');
      expect(twee).toContain('[[Continue->Hall (continued)]]');
      const back = await build(twee, 's.twee', 'structured');
      expect(shape(back.project), kind).toEqual(shape(project));
      expect(back.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    }
  });

  it('notes a break with nothing to show on one side', async () => {
    const { project } = await build('@passage a A\n@pause\nOne.\n@pause\n@pause\nTwo.\n@pause\n@end\n', 'm.md', 'structured');
    const notes = analyze(project).diagnostics.filter((d) => d.code === 'PAUSE_WITHOUT_TEXT');
    expect(notes).toHaveLength(3); // first, the second of a pair, and last
    const ok = await build('@passage a A\nOne.\n@pause\nTwo.\n@end\n', 'ok.md', 'structured');
    expect(analyze(ok.project).diagnostics.filter((d) => d.code === 'PAUSE_WITHOUT_TEXT')).toEqual([]);
  });

  it('adds and removes breaks from the Graph panel without disturbing the lines', async () => {
    const { addBreak, countBreaks, removeBreak } = await import('../src/ui/projectOps');
    const { project } = await build('@passage a A\nOne.\n\nTwo.\n\nThree.\n@end\n', 'g.md', 'structured');
    addBreak(project, 'a', 1);
    addBreak(project, 'a', 3);
    expect(kinds(project)).toEqual(['action,pause,action,pause,action']);
    expect(project.passages[0].content[1]).toMatchObject({ type: 'pause', origin: 'user_authored' });
    expect(countBreaks(project.passages[0])).toBe(2);
    removeBreak(project, 'a', 1);
    expect(kinds(project)).toEqual(['action,action,pause,action']);
    expect(processProject(project).generated.ink).toContain('Two.\n+ [Continue]\n-\nThree.');
  });
});

describe('Unity story UI', () => {
  const unity = async (project: StoryProject) =>
    ADAPTERS.unity.export(processProject(project), { engine: 'unity', projectName: 'UI', engineVersion: ADAPTERS.unity.defaultEngineVersion, integrationRef: 'v1.2.3', includeDemo: true });
  const file = (r: { files: { path: string; content: unknown }[] }, end: string) => String(r.files.find((f) => f.path.endsWith(end))?.content ?? '');

  it('ships the uGUI view, the theme and the uGUI package', async () => {
    const { project } = await build('@passage a A\nOne.\n@pause\nTwo.\n@end\n', 'u.md', 'structured');
    const r = await unity(project);
    expect(JSON.parse(file(r, 'Packages/manifest.json')).dependencies['com.unity.ugui']).toBeTruthy();
    expect(file(r, 'Scripts/NarrativeView.cs')).toContain('class NarrativeView');
    expect(file(r, 'Scripts/NarrativeTheme.cs')).toContain('class NarrativeTheme : ScriptableObject');
    const controller = r.files.map((f) => String(f.content)).find((c) => c.includes('IsWaitingForContinue'))!;
    expect(controller).toContain('ContinueShown');
    // Ink's Object and Unity's Object are both in scope there, so Unity's must be named in full.
    expect(file(r, 'Scripts/NarrativeView.cs')).not.toMatch(/[^.\w]Object\.Destroy/);
    const theme = JSON.parse(file(r, 'Resources/NarrativeBridgeTheme.json'));
    expect(theme).toMatchObject({ preset: 'book', layout: 'bottom', continueLabel: 'Continue', panelYMin: 0.03 });
  });

  it('exports the project theme, filled in from its preset and made safe', async () => {
    const { project } = await build('@passage a A\nOne.\n@end\n', 'u.md', 'structured');
    project.presentation = { unity: { preset: 'night', layout: 'center', fontSize: 400, continueLabel: '  Next  ', endLabel: '', text: 'red' } as never };
    const theme = JSON.parse(file(await unity(project), 'Resources/NarrativeBridgeTheme.json'));
    expect(theme).toMatchObject({ preset: 'night', background: '#1f2913', text: '#fefae0', layout: 'center', fontSize: 56, continueLabel: 'Next', endLabel: 'The End', panelXMin: 0.2 });
  });
});
