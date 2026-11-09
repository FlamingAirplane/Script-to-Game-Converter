import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reviewAll } from '../src/core/adapt';
import { analyze } from '../src/core/analyzer';
import { compareProjects, diffLines } from '../src/core/compare';
import { emphasisHtml, markupToTags, plainText, tagsToFountain } from '../src/core/emphasis';
import { fdxToFountain } from '../src/core/parsing/convert';
import { buildStory } from '../src/core/builder';
import { ADAPTERS, ExportBlockedError, type ExportResult } from '../src/core/export';
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
    expect(doc.blocks.find((b) => b.kind === 'action')).toMatchObject({ text: 'Action line with <i>emphasis</i>.', transformed: true });
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
    expect(gate.content).toMatchObject([{ type: 'action', text: 'The gate creaks. A <b>bird</b> calls.' }, { type: 'effect', effect: { type: 'add_var', variableId: 'apples', amount: 1 } }]);
    expect(gate.choices.map((c) => [c.text, c.conditions])).toEqual([['Go in', []], ['Leave', [{ type: 'has_item', itemId: 'basket' }]]]);
    const trees = project.passages.find((p) => p.title === 'Trees')!;
    expect(trees.content.find((c) => c.type === 'action')).toMatchObject({ text: 'Trees heavy with <i>red</i> apples. Take a basket.' });
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
    expect(html.match(/<script/g)!.length).toBe(7); // runtime, story, meta, clips, pictures, portraits, player
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
    expect(twineFileName(story, 'plain')).toBe('the-locked-archive-story-only.twee');
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
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'action', text: 'Rows of shelves vanish into the dark. <b>MIRA</b> lifts a lantern & squints.' }));
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
      expect(clip.path).toContain(engine === 'unity' ? 'Runtime/Resources/NarrativeBridge/a/Audio/' : 'StorySource/VoiceClips/');
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
    expect(JSON.parse(file(r, '/package.json')).dependencies['com.unity.ugui']).toBeTruthy();
    expect(file(r, 'Runtime/NarrativeView.cs')).toContain('class NarrativeView');
    expect(file(r, 'Runtime/NarrativeTheme.cs')).toContain('class NarrativeTheme : ScriptableObject');
    const controller = r.files.map((f) => String(f.content)).find((c) => c.includes('IsWaitingForContinue'))!;
    expect(controller).toContain('ContinueShown');
    // Ink's Object and Unity's Object are both in scope there, so Unity's must be named in full.
    expect(file(r, 'Runtime/NarrativeView.cs')).not.toMatch(/[^.\w]Object\.Destroy/);
    const theme = JSON.parse(file(r, '/Theme.json'));
    expect(theme).toMatchObject({ preset: 'book', layout: 'bottom', continueLabel: 'Continue', panelYMin: 0.03 });
  });

  it('exports the project theme, filled in from its preset and made safe', async () => {
    const { project } = await build('@passage a A\nOne.\n@end\n', 'u.md', 'structured');
    project.presentation = { unity: { preset: 'night', layout: 'center', fontSize: 400, continueLabel: '  Next  ', endLabel: '', text: 'red' } as never };
    const theme = JSON.parse(file(await unity(project), '/Theme.json'));
    expect(theme).toMatchObject({ preset: 'night', background: '#1f2913', text: '#fefae0', layout: 'center', fontSize: 72, continueLabel: 'Next', endLabel: 'The End', panelXMin: 0.2 });
  });
});

describe('Unity package', () => {
  const archive = async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    return processProject((await build(s.text, s.fileName, 'structured')).project);
  };
  const opts = { engine: 'unity' as const, projectName: 'Locked Archive', engineVersion: ADAPTERS.unity.defaultEngineVersion, integrationRef: '2.0.0', includeDemo: true };
  const text = (r: ExportResult, end: string) => String(r.files.find((f) => f.path.endsWith(end))?.content ?? '');
  const guid = (meta: string) => /guid: ([0-9a-f]{32})/.exec(meta)?.[1];

  it('is a Unity package with its own namespace and assemblies, and a .meta for everything Unity imports', async () => {
    const r = await ADAPTERS.unity.export(await archive(), { ...opts, packageVersion: '1.2.0' });
    expect(r.report.errors).toEqual([]);
    expect(r.rootName).toBe('com.narrativebridge.locked-archive');
    expect(r.unityPackage).toMatchObject({ name: 'com.narrativebridge.locked-archive', version: '1.2.0', root: 'com.narrativebridge.locked-archive/', namespace: 'NarrativeBridge.LockedArchive' });
    const paths = r.files.map((f) => f.path);
    const pkg = JSON.parse(text(r, 'locked-archive/package.json'));
    expect(pkg).toMatchObject({ name: 'com.narrativebridge.locked-archive', version: '1.2.0', unity: '2022.3' });
    expect(pkg.dependencies).not.toHaveProperty('com.inkle.ink-unity-integration');
    for (const sample of pkg.samples) expect(paths.some((p) => p.startsWith(`com.narrativebridge.locked-archive/${sample.path}/`))).toBe(true);
    // Every file and folder Unity imports has a .meta; folders ending in ~ are skipped, and need none.
    const root = 'com.narrativebridge.locked-archive/';
    const imported = paths.filter((p) => !p.endsWith('.meta') && !p.slice(root.length).split('/').some((x) => x.endsWith('~')));
    for (const p of imported) expect(paths, p).toContain(`${p}.meta`);
    for (const dir of ['Runtime', 'Runtime/Resources', 'Editor', 'Editor/Setup']) expect(text(r, `${root}${dir}.meta`)).toContain('folderAsset: yes');
    expect(paths.filter((p) => p.endsWith('.meta') && p.includes('~'))).toEqual([]);
    expect(text(r, 'NarrativeController.cs.meta')).toContain('MonoImporter:');
    expect(text(r, 'package.json.meta')).toContain('PackageManifestImporter:');
    const guids = r.files.filter((f) => f.path.endsWith('.meta')).map((f) => guid(String(f.content)));
    expect(new Set(guids).size).toBe(guids.length);
    // Exporting again keeps the GUIDs, so a game's scenes keep their references to the scripts.
    const again = await ADAPTERS.unity.export(await archive(), opts);
    expect(guid(text(again, 'NarrativeController.cs.meta'))).toBe(guid(text(r, 'NarrativeController.cs.meta')));
    const other = await ADAPTERS.unity.export(await archive(), { ...opts, projectName: 'Other Story' });
    expect(guid(text(other, 'NarrativeController.cs.meta'))).not.toBe(guid(text(r, 'NarrativeController.cs.meta')));
    // The scripts only compile once Ink is in the project, and the setup assembly (which installs it) needs nothing.
    const runtime = JSON.parse(text(r, 'Runtime/NarrativeBridge.LockedArchive.asmdef'));
    expect(runtime.defineConstraints).toEqual(['NARRATIVE_BRIDGE_INK']);
    expect(runtime.versionDefines).toContainEqual({ name: 'com.inkle.ink-unity-integration', expression: '1.0.0', define: 'NARRATIVE_BRIDGE_INK' });
    const setup = JSON.parse(text(r, 'NarrativeBridge.LockedArchive.Setup.asmdef'));
    expect([setup.references, setup.defineConstraints]).toEqual([[], []]);
    expect(text(r, 'InkSetup.cs')).toContain('const string InkPackage = "https://github.com/inkle/ink-unity-integration.git?path=/Packages/com.inkle.ink-unity-integration#2.0.0";');
    // Every script is in the story's namespace, with no template tokens left.
    for (const f of r.files.filter((x) => x.path.endsWith('.cs'))) {
      const c = String(f.content);
      expect(c, f.path).toMatch(/namespace NarrativeBridge\.LockedArchive\b|using NarrativeBridge\.LockedArchive;/);
      expect(c, f.path).not.toMatch(/__[A-Z_]+__/);
      // Ink.Runtime has Object and Path types too: with it in scope, Unity's and System.IO's are named in full.
      if (c.includes('using Ink.Runtime;')) expect(c, f.path).not.toMatch(/[^.\w](Object|Path)\.[A-Z]/);
    }
    const info = text(r, 'StoryInfo.cs');
    // Every knot but the entry knots for starting at a line (see lines.ts).
    const knots = [...(await archive()).generated.ink.matchAll(/^=== (\w+) ===$/gm)].map((m) => m[1]).filter((k) => !k.includes('__line_')).map((k) => `"${k}"`);
    expect(info).toContain(`Passages = { ${knots.join(', ')} };`);
    expect(info).toContain('public const string ResourceFolder = "NarrativeBridge/locked-archive/";');
    expect(text(r, 'NarrativeBridgeEditor.cs')).toContain('const string AssetFolder = "Assets/NarrativeBridge/LockedArchive";');
    // The package never edits a game's build settings or scenes by itself (only the complete project does, on first open).
    expect(text(r, 'NarrativeBridgeEditor.cs')).not.toContain('[InitializeOnLoad]');
    expect(text(r, 'Ink~/MainStory.ink')).toBe((await archive()).generated.ink);
  });

  it('can still be a complete Unity project, with the same package inside', async () => {
    const r = await ADAPTERS.unity.export(await archive(), { ...opts, projectName: 'Archive', unityLayout: 'project' });
    expect(r.report.errors).toEqual([]);
    expect(r.rootName).toBe('Archive');
    expect(r.unityPackage?.root).toBe('Archive/Packages/com.narrativebridge.archive/');
    expect(JSON.parse(text(r, 'Archive/Packages/manifest.json')).dependencies['com.inkle.ink-unity-integration']).toContain('#2.0.0');
    expect(text(r, 'Archive/Packages/com.narrativebridge.archive/package.json')).toContain('"name": "com.narrativebridge.archive"');
    expect(text(r, 'Assets/Editor/OpenDemoOnFirstOpen.cs')).toContain('NarrativeBridge.Archive.EditorTools.NarrativeBridgeEditor, NarrativeBridge.Archive.Editor');
    const bare = await ADAPTERS.unity.export(await archive(), { ...opts, projectName: 'Archive', unityLayout: 'project', includeDemo: false });
    expect(bare.files.some((f) => f.path.endsWith('OpenDemoOnFirstOpen.cs'))).toBe(false);
  });

  it('packs the package as a .tgz for Package Manager', async () => {
    const { unityTarball, unityTarballName } = await import('../src/core/export');
    const r = await ADAPTERS.unity.export(await archive(), opts);
    const tgz = (await unityTarball(r))!;
    expect(unityTarballName(r)).toBe('com.narrativebridge.locked-archive-1.0.0.tgz');
    const { gunzipSync } = await import('node:zlib');
    const tarBytes = gunzipSync(tgz);
    const entries = new Map<string, Buffer>();
    for (let at = 0; at + 512 <= tarBytes.length; ) {
      const h = tarBytes.subarray(at, at + 512);
      if (h.every((b) => b === 0)) break;
      const str = (o: number, n: number) => h.subarray(o, o + n).toString().replace(/\0.*$/s, '');
      const size = parseInt(str(124, 12), 8);
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
      expect(parseInt(str(148, 8), 8)).toBe(sum);
      const prefix = str(345, 155);
      entries.set(prefix ? `${prefix}/${str(0, 100)}` : str(0, 100), tarBytes.subarray(at + 512, at + 512 + size));
      at += 512 + Math.ceil(size / 512) * 512;
    }
    const inPackage = r.files.filter((f) => f.path.startsWith(r.unityPackage!.root));
    expect(entries.size).toBe(inPackage.length);
    expect(JSON.parse(entries.get('package/package.json')!.toString()).name).toBe('com.narrativebridge.locked-archive');
    const long = inPackage.find((f) => f.path.includes('Samples~'))!;
    expect(entries.get(`package/${long.path.slice(r.unityPackage!.root.length)}`)!.toString()).toBe(long.content);
    const { splitTarPath } = await import('../src/core/export/tar');
    const deep = `package/${'d'.repeat(90)}/${'f'.repeat(90)}.cs`;
    expect(splitTarPath(deep)).toEqual({ prefix: `package/${'d'.repeat(90)}`, name: `${'f'.repeat(90)}.cs` });
  });

  it('names the package, namespace and menus safely', async () => {
    const { unityPackageId } = await import('../src/core/export/unityPackage');
    expect(unityPackageId('LockedArchive', 'The Locked Archive')).toEqual({ name: 'com.narrativebridge.locked-archive', slug: 'locked-archive', namespace: 'NarrativeBridge.LockedArchive', menuTitle: 'The Locked Archive' });
    expect(unityPackageId('42 Days', 'Rock & Roll / Live').name).toBe('com.narrativebridge.story-42-days');
    expect(unityPackageId('42 Days', 'Rock & Roll / Live').menuTitle).toBe('Rock Roll Live');
    expect(unityPackageId('Ink', 'Ink').namespace).toBe('NarrativeBridge.InkStory');
    const { minimumUnity } = await import('../src/core/export/unity');
    expect(['2022.3.62f1', '6000.0.40f1', '2021.3.1f1', 'latest'].map(minimumUnity)).toEqual(['2022.3', '6000.0', '2022.3', '2022.3']);
    const r = await ADAPTERS.unity.export(await archive(), { ...opts, packageVersion: 'one' });
    expect(r.unityPackage?.version).toBe('1.0.0');
  });
});

describe('Unity story UI settings and portraits', () => {
  it('checks every setting, keeps a custom panel, and reads themes saved before the colours were split', async () => {
    const { normaliseUnityTheme, UNITY_THEME_FIELDS } = await import('../src/core/export/unityTheme');
    const t = normaliseUnityTheme({ preset: 'custom', accent: '#112233', muted: '#445566', layout: 'custom', panelXMin: 0.5, panelXMax: 0.51, panelYMin: 0.2, panelYMax: 0.9, transcript: 'sideways', portraitSide: 'alternate', portraitHeight: 5000, autoAdvanceDelay: -3, saveLabel: '  Keep  ' } as never);
    // Older themes had one accent for speaker names and buttons, and muted headings.
    expect([t.speakerColour, t.buttonColour, t.borderColour, t.sceneColour]).toEqual(['#112233', '#112233', '#112233', '#445566']);
    expect([t.panelXMin, t.panelXMax, t.panelYMin, t.panelYMax]).toEqual([0.5, 0.55, 0.2, 0.9]);
    expect([t.transcript, t.portraitSide, t.portraitHeight, t.autoAdvanceDelay, t.saveLabel]).toEqual(['history', 'alternate', 1000, 0.2, 'Keep']);
    // A preset layout decides the panel's corners.
    expect(normaliseUnityTheme({ layout: 'right', panelXMin: 0 } as never).panelXMin).toBe(0.57);
    // Every setting reaches the C# theme: a field, and a field of the exported JSON's class.
    const { THEME_CS } = await import('../src/core/export/unityUi');
    const exported = THEME_CS.slice(THEME_CS.indexOf('class Exported'), THEME_CS.indexOf('public void ApplyExported'));
    for (const f of UNITY_THEME_FIELDS) {
      if (f.key === 'layout') continue; // reaches Unity as the panel's corners (panelXMin…)
      expect(exported, f.key).toMatch(new RegExp(`[ ,]${f.key}[,;]`));
      if (!/^panel[XY]M|^reference(Width|Height)$/.test(f.key)) expect(THEME_CS, f.key).toMatch(new RegExp(`public [\\w.]+ ${f.key} =`));
    }
    expect(UNITY_THEME_FIELDS.length).toBeGreaterThanOrEqual(60);
  });

  it('shows the speaking character’s portrait in Unity and the playable story', async () => {
    const { buildPlayableHtml } = await import('../src/core/export');
    const { referencedImages } = await import('../src/core/images');
    const { project } = await build('@passage hall Hall\nThe hall is dark.\n\nMIRA: Who is there?\n\nTOMAS: Only me.\n@end\n', 'p.md', 'structured');
    const mira = project.characters.find((c) => c.displayName.toUpperCase() === 'MIRA')!;
    mira.portrait = { id: 'img_portrait_mira_1', name: 'mira.png', mime: 'image/png', alt: 'Portrait of Mira' };
    expect(referencedImages(project).map((r) => r.id)).toContain('img_portrait_mira_1');
    const story = processProject(project);
    const png = { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) };
    const r = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'P', engineVersion: '6000.0', integrationRef: 'v1.2.3', includeDemo: true, images: { img_portrait_mira_1: png } });
    expect(r.report.warnings.filter((w) => /picture/.test(w))).toEqual([]);
    expect(r.files.map((f) => f.path)).toContain('com.narrativebridge.p/Runtime/Resources/NarrativeBridge/p/Images/img_portrait_mira_1.png.bytes');
    const info = String(r.files.find((f) => f.path.endsWith('StoryInfo.cs'))!.content);
    expect(info).toContain(`PortraitSpeakers = { "${mira.id}" };`);
    expect(info).toContain('PortraitFiles = { "img_portrait_mira_1.png" };');
    const controller = String(r.files.find((f) => f.path.endsWith('NarrativeController.cs'))!.content);
    expect(controller).toContain('public static Texture2D LoadPortrait(string speakerId)');
    expect(String(r.files.find((f) => f.path.endsWith('NarrativeView.cs'))!.content)).toContain('public Texture Portrait =>');
    const html = buildPlayableHtml(story, '/* runtime */', {}, { img_portrait_mira_1: png });
    expect(JSON.parse(/<script id="story-portraits" type="application\/json">([^<]*)<\/script>/.exec(html)![1])).toEqual({ [mira.id]: 'img_portrait_mira_1.png' });
  });
});

describe('gated choices', () => {
  it('lists the choices a reader cannot take yet, with what they need in plain words', async () => {
    const { conditionHolds, describeCondition, lockedChoices } = await import('../src/core/gating');
    const { project } = await build(
      '@item key "Brass Key"\n@item lamp "Lamp"\n@var trust = 0\n@passage a A\nHall.\n+ {has key} [Unlock] -> a\n+ {trust >= 2 and not has lamp} [Trust her] -> a\n+ [Wait] -> a\n',
      'g.md',
      'structured',
    );
    const vars: Record<string, unknown> = { has_key: false, has_lamp: false, trust: 0 };
    const read = (n: string) => vars[n];
    const locked = lockedChoices(project, 'a', read, ['Wait']);
    expect(locked.map((l) => [l.choice.text, l.needs])).toEqual([
      ['Unlock', ['Brass Key']],
      ['Trust her', ['trust at least 2 and no Lamp']],
    ]);
    vars.has_key = true;
    vars.trust = 3;
    expect(lockedChoices(project, 'a', read, ['Wait', 'Unlock']).map((l) => l.choice.text)).toEqual([]);
    // A choice already on offer is never listed twice, even if the condition reads as false.
    vars.has_key = false;
    expect(lockedChoices(project, 'a', read, ['Unlock']).map((l) => l.choice.text)).toEqual([]);
    expect(conditionHolds({ type: 'or', conditions: [{ type: 'has_item', itemId: 'lamp' }, { type: 'compare', variableId: 'trust', op: '!=', value: 3 }] }, read)).toBe(false);
    expect(describeCondition({ type: 'not', condition: { type: 'compare', variableId: 'trust', op: '<', value: 1 } }, project)).toBe('not trust below 1');
  });
});

describe('scene pictures and recordings', () => {
  const src = '@passage hall Hall\nThe hall is dark.\n\nMIRA: Who is there?\n\nTOMAS: Only me.\n-> room\n@passage room Room\n@end\n';
  const png = { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) };

  it('tags the first line of a scene with its picture and ships it in every export', async () => {
    const { buildPlayableHtml } = await import('../src/core/export');
    const { project } = await build(src, 'p.md', 'structured');
    project.passages[0].image = { id: 'img_hall_1', name: 'hall.png', mime: 'image/png', width: 4, height: 3, alt: 'A dark hall' };
    const story = processProject(project);
    expect(story.compile.ok).toBe(true);
    expect(story.generated.ink).toMatch(/^The hall is dark\. #image:img_hall_1\.png$/m);
    // Re-importing that Ink keeps the story and does not count the tag as something it lost.
    const { inkUnsupported } = await import('../src/core/parsing/ink');
    expect(inkUnsupported(story.generated.ink)).toEqual([]);
    const opts = { engineVersion: '6000.0', integrationRef: 'v1.2.3', includeDemo: true, images: { img_hall_1: png } };
    const unity = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'P', ...opts });
    expect(unity.files.map((f) => f.path)).toContain('com.narrativebridge.p/Runtime/Resources/NarrativeBridge/p/Images/img_hall_1.png.bytes');
    expect(unity.report.warnings.filter((w) => /picture/.test(w))).toEqual([]);
    const unreal = await ADAPTERS.unreal.export(story, { engine: 'unreal', projectName: 'P', ...opts, engineVersion: '5.7' });
    expect(unreal.files.map((f) => f.path)).toContain('P/Content/NarrativeBridge/Data/Images/img_hall_1.png');
    const missing = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'P', ...opts, images: {} });
    expect(missing.report.warnings).toContain('Scene picture "hall.png" is missing from this browser, so it was left out of the package.');
    const html = buildPlayableHtml(story, '/* runtime */', {}, { img_hall_1: png });
    const pictures = JSON.parse(/<script id="story-pictures" type="application\/json">([^<]*)<\/script>/.exec(html)![1]);
    expect(pictures['img_hall_1.png']).toEqual({ src: 'data:image/png;base64,iVBORw==', alt: 'A dark hall' });
  });

  it('warns when a picture has no line of text to open it', async () => {
    const { project } = await build(src, 'p.md', 'structured');
    project.passages[1].image = { id: 'img_room', name: 'room.png', mime: 'image/png' };
    expect(analyze(project).diagnostics.filter((d) => d.code === 'IMAGE_WITHOUT_TEXT').map((d) => d.entityId)).toEqual(['room']);
  });

  it('matches recording files to lines by the script\'s clip name, an existing clip, or the row number', async () => {
    const { buildRecordingScript, matchRecordings } = await import('../src/core/export');
    const { project } = await build(src, 'p.md', 'structured');
    const kinds = project.passages[0].content.map((b) => b.type);
    expect(kinds).toEqual(['action', 'dialogue', 'dialogue']);
    // Clips are numbered by the passage's dialogue lines, so the narration before them leaves no gap.
    const csv = buildRecordingScript(project);
    expect(csv).toContain('hall_001.wav');
    expect(csv).toContain('hall_002.wav');
    expect(csv).not.toContain('hall_003.wav');
    // A file named from an older recording script (numbered with the narration) still finds its line.
    expect(matchRecordings(project, ['hall_003.wav']).matched.map((m) => m.index)).toEqual([2]);
    project.passages[0].content[2] = { ...(project.passages[0].content[2] as Extract<(typeof project.passages)[0]['content'][number], { type: 'dialogue' }>), audio: { id: 'vo_tomas_ab12', name: 'old.wav', mime: 'audio/wav' } };
    const r = matchRecordings(project, ['HALL_001.WAV', 'vo_tomas_ab12.mp3', 'notes.wav', '2.wav', '01.ogg']);
    expect(r.matched.map((m) => [m.file, m.passageId, m.index])).toEqual([
      ['HALL_001.WAV', 'hall', 1],
      ['vo_tomas_ab12.mp3', 'hall', 2],
    ]);
    // "2.wav" is the second line, already matched; "01.ogg" is the first, already matched too.
    expect(r.unmatched).toEqual(['notes.wav', '2.wav', '01.ogg']);
  });
});

describe('admin design editor', () => {
  it('turns a design into CSS that wins over the app, per theme, and keeps files safe', async () => {
    const { designCss, normaliseDesign, designChanges, ruleKey, splitRuleKey } = await import('../src/ui/design/design');
    const d = normaliseDesign({
      format: 'narrative-bridge-design',
      tokens: { '--radius': '9px', 'not a var': '1px', '--bad': 'x } body { display: none' },
      light: { '--paper': '#ffffff' },
      dark: { '--paper': '#000000' },
      rules: { '.btn': { 'letter-spacing': '0.2em', 'bad prop': 'x' }, [ruleKey('.ribbon', '(max-width: 760px)')]: { display: 'block' }, 'a { b': { color: 'red' } },
      words: { brand: 'Story Forge', unknown: 'x' },
      settings: { sound: false, theme: 'sepia', showLocked: 'yes' },
    });
    expect(d.tokens).toEqual({ '--radius': '9px', '--bad': 'x  body  display: none' });
    expect(Object.keys(d.rules)).toEqual(['.btn', '@media (max-width: 760px)|.ribbon']);
    expect(d.words).toEqual({ brand: 'Story Forge' });
    expect(d.settings).toEqual({ sound: false });
    expect(designChanges(d)).toBe(8);
    expect(splitRuleKey('@media (max-width: 760px)|.ribbon')).toEqual({ media: '(max-width: 760px)', selector: '.ribbon' });
    const css = designCss(d);
    expect(css).toContain(":root:root:root { --radius: 9px;");
    expect(css).toContain(":root:root:root[data-theme='light'] { --paper: #ffffff; }");
    expect(css).toContain("@media (prefers-color-scheme: dark) { :root:root:root:not([data-theme='light']) { --paper: #000000; } }");
    expect(css).toContain('.btn { letter-spacing: 0.2em; }');
    expect(css).toContain('@media (max-width: 760px) { .ribbon { display: block; } }');
    expect(css).not.toMatch(/\}\s*body\s*\{/);
  });

  it('checks the password the way the build hashed it, and reads colours and rules', async () => {
    const { pbkdf2Sync } = await import('node:crypto');
    const { checkPassword, stretch } = await import('../src/ui/admin/lock');
    const salt = Buffer.from('0123456789abcdef');
    const lock = { salt: salt.toString('base64'), hash: pbkdf2Sync('open sesame', salt, 1000, 32, 'sha256').toString('base64'), iterations: 1000 };
    expect(await stretch('open sesame', lock.salt, 1000)).toBe(lock.hash);
    expect(await checkPassword('open sesame', lock)).toBe(true);
    expect(await checkPassword('open sesame ', lock)).toBe(false);
    expect(await checkPassword('', lock)).toBe(false);
    expect(await checkPassword('open sesame', null)).toBe(false);
    const { parseColour, formatColour } = await import('../src/ui/admin/AdminRoot');
    expect(parseColour('#abc')).toEqual({ hex: '#aabbcc', alpha: 1 });
    expect(parseColour('rgba(96, 108, 56, 0.1)')).toEqual({ hex: '#606c38', alpha: 0.1 });
    expect(parseColour('color-mix(in srgb, red 10%, transparent)')).toBeNull();
    expect(formatColour('#606c38', 0.25)).toBe('rgba(96, 108, 56, 0.25)');
    expect(formatColour('#606c38', 1)).toBe('#606c38');
    const { parseDeclarations, splitTopLevel } = await import('../src/ui/admin/rules');
    expect(parseDeclarations('color: red; background: url("a;b.png") no-repeat; padding: 2px !important; --x: 1')).toEqual([
      { prop: 'color', value: 'red', important: false },
      { prop: 'background', value: 'url("a;b.png") no-repeat', important: false },
      { prop: 'padding', value: '2px', important: true },
      { prop: '--x', value: '1', important: false },
    ]);
    expect(splitTopLevel('.a:is(.b, .c), .d', ',')).toEqual(['.a:is(.b, .c)', '.d']);
  });

  it('lists every design variable the stylesheet defines', async () => {
    const { TOKENS } = await import('../src/ui/design/tokens');
    const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
    for (const t of TOKENS) expect(root, t.name).toContain(`${t.name}:`);
  });
});

describe('exits to the game', () => {
  const src = '@passage camp Camp\nWolves circle the fire.\n@exit wolf_fight The player fights the wolves\nThe last wolf runs.\n+ [Rest] -> dawn\n@passage dawn Dawn\nMorning.\n@end\n';
  it('stops the dialogue at an exit, in Ink and back again', async () => {
    const { exitOf, EXIT_PREFIX } = await import('../src/core/isr');
    const { project } = await build(src, 'x.md', 'structured');
    expect(project.passages[0].content.find((b) => b.type === 'exit')).toMatchObject({ type: 'exit', name: 'wolf_fight', note: 'The player fights the wolves' });
    const story = processProject(project);
    expect(story.compile.ok).toBe(true);
    expect(story.generated.ink).toContain('+ [Back to the game: wolf_fight] // The player fights the wolves\n-');
    expect(exitOf(`${EXIT_PREFIX}wolf_fight`)).toBe('wolf_fight');
    expect(exitOf('Rest')).toBeNull();
    // The game sees the exit as the only choice, and taking it goes on with the scene.
    const { Story } = await import('inkjs');
    const s = new Story(story.compile.json!);
    expect(s.ContinueMaximally()).toContain('Wolves circle the fire.');
    expect(s.currentChoices.map((c) => c.text)).toEqual(['Back to the game: wolf_fight']);
    s.ChooseChoiceIndex(0);
    expect(s.ContinueMaximally()).toContain('The last wolf runs.');
    // Ink that Narrative Bridge wrote comes back with its exit.
    const again = await build(story.generated.ink, 'x.ink', 'faithful');
    expect(again.project.passages.find((p) => p.id === 'camp')!.content.find((b) => b.type === 'exit')).toMatchObject({ name: 'wolf_fight', note: 'The player fights the wolves' });
  });

  it('lists the exits for the game, and plays through them elsewhere', async () => {
    const { project } = await build(src, 'x.md', 'structured');
    const story = processProject(project);
    const r = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'Wolves', engineVersion: '6000.0', integrationRef: 'v1.2.3', includeDemo: true });
    const text = (end: string) => String(r.files.find((f) => f.path.endsWith(end))!.content);
    expect(text('StoryInfo.cs')).toContain('public static readonly string[] Exits = { "wolf_fight" };');
    expect(text('NarrativeController.cs')).toContain('public void ResumeAt(string passage)');
    expect(text('Samples~/Hooking into your game/StoryExits.cs')).toContain('story.ExitReached += Reached;');
    // Generated C# without "using System;" must name System's types in full.
    for (const f of r.files.filter((x) => x.path.endsWith('.cs'))) {
      const c = String(f.content);
      if (!c.includes('using System;')) expect(c, f.path).not.toMatch(/[^.\w](Array|StringComparison|Exception)\./);
      expect(c, f.path).not.toContain('""storyVersion');
    }
    const { buildPlayableHtml, buildTwee } = await import('../src/core/export');
    expect(buildPlayableHtml(story, '/* runtime */')).toContain("Resume the story");
    // Twine has no game: the exit is a Continue link, with a note.
    const twee = buildTwee(story, 'sugarcube');
    expect(twee).toContain('Back to the game: wolf_fight');
    expect(twee).toMatch(/:: Camp \(continued\)/);
  });
});

describe('story files', () => {
  it('lists every file put into a story, with names to save them under and unique zip paths', async () => {
    const { storyFiles, zipPaths, safeFileName } = await import('../src/core/files');
    const { project } = await build('@passage hall Hall\nThe hall is dark.\n\nMIRA: Who is there?\n\nMIRA: Hello?\n@end\n', 'scene one.md', 'structured');
    project.sources.push({ ...project.sources[0], id: 'pdf', fileName: 'Draft 2.pdf', format: 'fountain', text: 'INT. HALL' });
    const lines = project.passages[0].content.filter((b) => b.type === 'dialogue');
    (lines[0] as { audio?: unknown }).audio = { id: 'vo_a', name: 'take1.wav', mime: 'audio/wav' };
    (lines[1] as { audio?: unknown }).audio = { id: 'vo_b', name: 'take1.wav', mime: 'audio/wav' };
    project.passages[0].image = { id: 'img_hall', name: 'hall.png', mime: 'image/png' };
    project.characters[0].portrait = { id: 'img_mira', name: 'mira face.jpg', mime: 'image/jpeg' };
    const files = storyFiles(project);
    expect(files.map((f) => [f.kind, f.fileName])).toEqual([
      ['script', 'scene one.md'],
      ['script', 'Draft 2.fountain'],
      ['picture', 'hall.png'],
      ['recording', 'take1.wav'],
      ['recording', 'take1.wav'],
      ['portrait', 'mira face.jpg'],
    ]);
    expect(files[1]).toMatchObject({ convertedFrom: 'pdf', text: 'INT. HALL' });
    expect(files[3].context).toContain('Who is there?');
    expect(zipPaths(files)).toEqual(['Scripts/scene one.md', 'Scripts/Draft 2.fountain', 'Scene pictures/hall.png', 'Recordings/take1.wav', 'Recordings/take1 (2).wav', 'Portraits/mira face.jpg']);
    expect(safeFileName('a/b:c?.wav')).toBe('a_b_c_.wav');
  });
});

describe('recording sessions', () => {
  it('reads and writes times', async () => {
    const { formatTime, parseTime } = await import('../src/core/session');
    expect([formatTime(0), formatTime(75.5), formatTime(3723.4)]).toEqual(['0:00.00', '1:15.50', '1:02:03.40']);
    expect(['1:15.5', '75.5', '1:02:03.4', '1:15,5', 'abc', '1:75', ''].map(parseTime)).toEqual([75.5, 75.5, 3723.4, 75.5, null, null, null]);
  });

  it('finds the takes in a session and gives them to lines in order, cutting them cleanly', async () => {
    const { detectSegments, assignInOrder, cutSamples } = await import('../src/core/session');
    const rate = 8000;
    // Quiet room tone, with three spoken takes at 1–2 s, 3–3.6 s and 5–6.5 s, and a click at 4.3 s (too short to be a take).
    const s = new Float32Array(rate * 8);
    for (let i = 0; i < s.length; i++) s[i] = Math.sin(i * 12.9898) * 0.002;
    const speak = (a: number, b: number) => {
      for (let i = a * rate; i < b * rate; i++) s[i] = Math.sin(i / 3) * 0.5;
    };
    speak(1, 2);
    speak(3, 3.6);
    speak(5, 6.5);
    for (let i = 4.3 * rate; i < 4.3 * rate + 40; i++) s[i] = 0.6;
    const takes = detectSegments(s, rate);
    expect(takes).toHaveLength(3);
    takes.forEach((t, i) => {
      const [a, b] = [[1, 2], [3, 3.6], [5, 6.5]][i];
      expect(t.start).toBeGreaterThan(a - 0.2);
      expect(t.start).toBeLessThanOrEqual(a);
      expect(t.end).toBeGreaterThanOrEqual(b);
      expect(t.end).toBeLessThan(b + 0.2);
    });
    // A long minimum pause joins takes that are close together.
    expect(detectSegments(s, rate, { minGap: 1.5 }).length).toBeLessThan(3);
    expect(assignInOrder(['a', 'b'], takes)).toEqual({ a: takes[0], b: takes[1] });
    const cut = cutSamples(s, rate, { start: 1, end: 2 });
    expect(cut.length).toBe(rate);
    expect(Math.abs(cut[0])).toBe(0); // faded in
    expect(detectSegments(new Float32Array(rate), rate)).toEqual([]);
  });

  it('lists the lines in recording-script order with where their clips came from', async () => {
    const { sessionLines, clipName } = await import('../src/core/session');
    const { project } = await build('@passage hall Hall\nThe hall is dark.\n\nMIRA: Who is there?\n\nTOMAS: Only me.\n@end\n', 'p.md', 'structured');
    const second = project.passages[0].content.filter((b) => b.type === 'dialogue')[1] as { audio?: unknown };
    second.audio = { id: 'vo_x', name: 'x.wav', mime: 'audio/wav', from: { session: 'ses_1', start: 3, end: 4.5 } };
    const lines = sessionLines(project);
    expect(lines.map((l) => [l.number, l.speaker, l.text, l.from?.start])).toEqual([
      [1, 'MIRA', 'Who is there?', undefined],
      [2, 'TOMAS', 'Only me.', 3],
    ]);
    expect(lines[0].slot).toMatch(/^hall_\d{3}$/);
    expect(clipName({ id: 'ses_1', name: 'Mira day 1.wav', mime: 'audio/wav' }, { start: 62.5, end: 65.1 })).toBe('Mira day 1 1.02.50–1.05.10.wav');
  });
});

describe('story map arrows', () => {
  const card = (x: number, y: number) => ({ x, y, w: 188, h: 56 });
  it('goes around cards in the way and uses the sides that face each other', async () => {
    const { routeEdges, routeHits } = await import('../src/core/edgeRouting');
    // A and B in a row with C between them; D straight below A.
    const cards = new Map([['a', card(0, 0)], ['c', card(300, 0)], ['b', card(600, 0)], ['d', card(0, 300)]]);
    const routes = routeEdges(cards, [
      { id: 'ab', from: 'a', to: 'b' },
      { id: 'ad', from: 'a', to: 'd' },
      { id: 'db', from: 'd', to: 'b' },
    ]);
    expect(routeHits(routes.get('ab')!, cards.get('c')!)).toBe(false);
    expect([routes.get('ad')!.fromSide, routes.get('ad')!.toSide]).toEqual(['bottom', 'top']);
  });

  it('spreads arrows that share a side, in the order of where they go', async () => {
    const { routeEdges } = await import('../src/core/edgeRouting');
    const cards = new Map([['a', card(0, 200)], ['b', card(400, 0)], ['c', card(400, 200)], ['d', card(400, 400)]]);
    const routes = routeEdges(cards, ['b', 'c', 'd'].map((t) => ({ id: t, from: 'a', to: t })));
    const starts = ['b', 'c', 'd'].map((t) => routes.get(t)!).map((r) => r.d.match(/^M(-?[\d.]+),(-?[\d.]+)/)!.slice(1).map(Number));
    expect(new Set(starts.map((s) => s.join(','))).size).toBe(3);
    // All leave by the right side, top to bottom in the order of their targets.
    expect(starts.every((s) => s[0] === 188)).toBe(true);
    expect(starts[0][1]).toBeLessThan(starts[1][1]);
    expect(starts[1][1]).toBeLessThan(starts[2][1]);
    const self = routeEdges(cards, [{ id: 'loop', from: 'a', to: 'a' }]).get('loop')!;
    expect(self.d).toMatch(/^M188,/);
  });
});

describe('small fixes', () => {
  it('warns about exits the game can’t tell apart, and an exit right before the end', async () => {
    const { project } = await build('@passage a A\nOne.\n@exit fight\nTwo.\n-> b\n@passage b B\nThree.\n@exit fight\n@end\n', 'e.md', 'structured');
    const codes = analyze(project).diagnostics.map((d) => d.code);
    expect(codes).toContain('EXIT_NAME_REUSED');
    expect(codes).toContain('EXIT_THEN_END');
  });

  it('shows a clip’s file name, shortened in the middle when long', async () => {
    const { clipLabel } = await import('../src/ui/VoiceControls');
    expect(clipLabel('take1.wav')).toBe('take1');
    expect(clipLabel('Mira session 1.02.50–1.05.10.wav')).toBe('Mira session 1.02.50–1.05.10');
    expect(clipLabel('Mira recording session one 1.02.50–1.05.10.wav')).toBe('Mira recording s…50–1.05.10');
  });
});

describe('live design', () => {
  it('reads the published design from its Gist, keeps it for the next visit, and ignores anything else', async () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    Object.assign(globalThis, { localStorage: store, sessionStorage: store });
    const { loadLiveDesign, setLocalGist, gistId } = await import('../src/ui/design/live');
    const { designState } = await import('../src/ui/design/design');
    expect(await loadLiveDesign(async () => new Response('{}'))).toBe('none'); // no Gist yet
    setLocalGist('0123456789abcdef0123');
    expect(gistId()).toBe('0123456789abcdef0123');
    const design = { format: 'narrative-bridge-design', version: 1, name: 'Live', tokens: { '--radius': '8px' }, words: { brand: 'Story Forge' } };
    const asked: string[] = [];
    const gist = async (url: string | URL | Request) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ files: { 'design.json': { content: JSON.stringify(design) } } }));
    };
    expect(await loadLiveDesign(gist as typeof fetch)).toBe('updated');
    expect(asked).toEqual(['https://api.github.com/gists/0123456789abcdef0123']);
    expect(designState().design.tokens['--radius']).toBe('8px');
    expect(designState().published.words.brand).toBe('Story Forge');
    expect(mem.get('narrative-bridge.design-live')).toContain('Story Forge');
    expect(await loadLiveDesign(gist as typeof fetch)).toBe('same');
    // Not a design, or GitHub unreachable: the last copy stays.
    expect(await loadLiveDesign((async () => new Response(JSON.stringify({ files: { 'design.json': { content: '{"format":"other"}' } } }))) as typeof fetch)).toBe('failed');
    expect(await loadLiveDesign((async () => { throw new Error('offline'); }) as typeof fetch)).toBe('failed');
    expect(designState().published.words.brand).toBe('Story Forge');
  });
});

describe('projects on other browsers', () => {
  it('packs every kind of media a project uses', async () => {
    const { projectMediaRefs } = await import('../src/ui/projectFile');
    const { project } = await build('@passage hall Hall\nMIRA: Who is there?\n\nMIRA: Hello?\n@end\n', 'm.md', 'structured');
    const [a, b] = project.passages[0].content.filter((x) => x.type === 'dialogue') as { audio?: unknown }[];
    a.audio = { id: 'vo_own', name: 'take.wav', mime: 'audio/wav' };
    b.audio = { id: 'vo_region', name: 'r.wav', mime: 'audio/wav', from: { session: 'ses_1', start: 0, end: 1 }, region: true };
    project.passages[0].image = { id: 'img_hall', name: 'hall.png', mime: 'image/png' };
    project.characters[0].portrait = { id: 'img_mira', name: 'mira.png', mime: 'image/png' };
    project.sessions = [{ id: 'ses_1', name: 'Session.wav', mime: 'audio/wav' }];
    (project.sources[0] as { original?: unknown }).original = { id: 'orig_1', name: 'm.docx', mime: 'application/x', byteLength: 3 };
    // A region has no file of its own: the session it plays from goes instead.
    expect(projectMediaRefs(project).map((r) => r.id).sort()).toEqual(['img_hall', 'img_mira', 'orig_1', 'ses_1', 'vo_own']);
  });

  it('saves to a private Gist, lists your projects, and opens big ones from the raw file', async () => {
    const mem = new Map<string, string>();
    Object.assign(globalThis, { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } });
    const { saveToCloud, listCloudProjects, loadFromCloud, cloudIdOf, parseDescription } = await import('../src/ui/cloud');
    const calls: { method: string; url: string; body?: { public?: boolean; description?: string; files?: Record<string, unknown> } }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'POST') return new Response(JSON.stringify({ id: 'abc123' }));
      if (method === 'PATCH') return new Response('{}');
      if (String(url).includes('?per_page')) return new Response(JSON.stringify([{ id: 'abc123', description: 'Narrative Bridge project: The Archive (archive)', updated_at: '2026-11-06T10:00:00Z', html_url: 'https://gist.github.com/abc123' }, { id: 'zzz', description: 'my notes', updated_at: '2026-11-06T11:00:00Z', html_url: '' }]));
      if (String(url).endsWith('/abc123')) return new Response(JSON.stringify({ description: 'Narrative Bridge project: The Archive (archive)', files: { 'archive.nbproj.json': { filename: 'archive.nbproj.json', truncated: true, content: '{', raw_url: 'https://gist.githubusercontent.com/raw/x' } } }));
      if (String(url).includes('raw')) return new Response('{"project":"full"}');
      return new Response('', { status: 500 });
    }) as typeof fetch;
    try {
      expect(await saveToCloud('t', '{"x":1}', 'The Archive', 'archive')).toEqual({ gistId: 'abc123', created: true });
      expect(calls[0].body).toMatchObject({ public: false, description: 'Narrative Bridge project: The Archive (archive)' });
      expect(Object.keys(calls[0].body!.files!)).toEqual(['archive.nbproj.json']);
      expect(cloudIdOf('archive')).toBe('abc123');
      expect(await saveToCloud('t', '{"x":2}', 'The Archive', 'archive')).toEqual({ gistId: 'abc123', created: false });
      expect(calls[1].method).toBe('PATCH');
      expect((await listCloudProjects('t')).map((p) => [p.title, p.projectId])).toEqual([['The Archive', 'archive']]);
      expect(await loadFromCloud('t', 'abc123')).toBe('{"project":"full"}');
      expect(parseDescription('something else')).toBeNull();
      await expect(saveToCloud('t', 'x'.repeat(51 * 1024 * 1024), 'Big', 'big')).rejects.toThrow(/too big/);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('non-destructive clips', () => {
  it('trims, fades and changes gain without touching the source', async () => {
    const { applyEdit, hasEdit, isRendered, audioFileName } = await import('../src/core/audio');
    const rate = 1000;
    const src = new Float32Array(rate).fill(0.5); // one second
    expect(applyEdit(src, rate)).toEqual(src);
    const out = applyEdit(src, rate, { trimStart: 0.1, trimEnd: 0.2, fadeIn: 0.1, fadeOut: 0.1, gain: 6 });
    expect(out.length).toBe(700);
    expect(src[0]).toBe(0.5); // the source is unchanged
    expect(out[0]).toBe(0); // fades in from silence
    expect(out[350]).toBeCloseTo(0.5 * Math.pow(10, 6 / 20), 3); // +6 dB in the middle
    expect(out[699]).toBe(0); // and fades out
    expect(applyEdit(src, rate, { gain: 30 })[10]).toBe(1); // never clips past full scale
    expect([hasEdit({}), hasEdit({ gain: 0 }), hasEdit({ fadeIn: 0.2 })]).toEqual([false, false, true]);
    // A clip plays from its own file until it's a region or edited; then it's rendered as WAV.
    expect(audioFileName({ id: 'vo_a', mime: 'audio/mpeg' })).toBe('vo_a.mp3');
    expect(audioFileName({ id: 'vo_a', mime: 'audio/mpeg', edit: { fadeOut: 0.5 } })).toBe('vo_a.wav');
    expect(isRendered({ region: true })).toBe(true);
  });

  it('exports a region or edited clip under its WAV name in the Ink and the package', async () => {
    const { project } = await build('@passage hall Hall\nMIRA: Who is there?\n@end\n', 'r.md', 'structured');
    const line = project.passages[0].content.find((b) => b.type === 'dialogue') as { audio?: unknown };
    line.audio = { id: 'vo_mira_x', name: 'Session 0.01.00–0.02.00.wav', mime: 'audio/wav', from: { session: 'ses_1', start: 1, end: 2 }, region: true };
    const story = processProject(project);
    expect(story.generated.ink).toContain('#audio:vo_mira_x.wav');
    const wav = { mime: 'audio/wav', bytes: new Uint8Array([82, 73, 70, 70]) };
    const r = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'R', engineVersion: '6000.0', integrationRef: 'v1.2.3', includeDemo: true, audio: { vo_mira_x: wav } });
    expect(r.files.some((f) => f.path.endsWith('Audio/vo_mira_x.wav'))).toBe(true);
  });
});

describe('Unity text', () => {
  it('uses TextMeshPro when the game has it, and the older Text otherwise', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const r = await ADAPTERS.unity.export(processProject((await build(s.text, s.fileName, 'structured')).project), { engine: 'unity', projectName: 'T', engineVersion: ADAPTERS.unity.defaultEngineVersion, integrationRef: '2.0.0', includeDemo: true });
    const view = String(r.files.find((f) => f.path.endsWith('NarrativeView.cs'))!.content);
    expect(view).toContain('#if NARRATIVE_BRIDGE_TMP\nusing UIText = TMPro.TextMeshProUGUI;\n#else\nusing UIText = UnityEngine.UI.Text;');
    expect(view).not.toMatch(/AddComponent<Text>/);
    const asmdef = JSON.parse(String(r.files.find((f) => f.path.endsWith('Runtime/NarrativeBridge.T.asmdef'))!.content));
    expect(asmdef.references).toContain('Unity.TextMeshPro');
    expect(asmdef.versionDefines).toContainEqual({ name: 'com.unity.ugui', expression: '2.0.0', define: 'NARRATIVE_BRIDGE_TMP' });
    expect(ADAPTERS.unity.defaultEngineVersion).toMatch(/^6000\./);
    expect(JSON.parse(String(r.files.find((f) => f.path.endsWith('T/package.json') || f.path.endsWith('.t/package.json'))!.content)).unity).toBe('2022.3');
  });
});

describe('original files', () => {
  it('keeps a PDF beside the text taken from it: in the story, Files and exports', async () => {
    const { prepareInput } = await import('../src/core/parsing/convert');
    const { storyFiles } = await import('../src/core/files');
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/lighthouse.pdf', import.meta.url)));
    const input = await prepareInput('Lighthouse draft.pdf', bytes);
    expect(input.original).toMatchObject({ name: 'Lighthouse draft.pdf', mime: 'application/pdf', byteLength: bytes.length });
    expect(input.original!.id).toMatch(/^orig_[0-9a-f]{20}$/);
    expect(input.originalBytes).toBe(bytes);
    // The same file is the same original.
    expect((await prepareInput('copy.pdf', bytes)).original!.id).toBe(input.original!.id);
    const { project } = await buildStory([input], { mode: 'faithful' });
    expect(project.sources[0].original).toEqual(input.original);
    expect(JSON.stringify(project)).not.toContain('originalBytes');
    const files = storyFiles(project).filter((f) => f.kind === 'script');
    expect(files.map((f) => [f.fileName, f.context, f.id ?? null])).toEqual([
      ['Lighthouse draft.fountain', 'the text taken from Lighthouse draft.pdf', null],
      ['Lighthouse draft.pdf', 'the original file', input.original!.id],
    ]);
    const story = processProject(project);
    const r = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'L', engineVersion: '6000.0', integrationRef: 'v1.2.3', includeDemo: true, originals: { [input.original!.id]: { mime: 'application/pdf', bytes } } });
    const docs = r.files.filter((f) => f.path.includes('SourceDocuments/'));
    expect(docs.map((f) => f.path.split('/').pop())).toEqual(['Lighthouse draft.fountain', 'Lighthouse draft.pdf']);
    expect(docs[1].content).toBe(bytes);
    // Plain text scripts have no separate original.
    expect((await prepareInput('a.fountain', 'INT. HALL')).original).toBeUndefined();
  });
});

describe('hands-on review fixes', () => {
  it('points an item that only a waiting suggestion gives at that suggestion, not at @give', async () => {
    const { project } = await build('@var lamp = 0\n@passage a A\nA locked door.\n* [Take the brass key] -> a @give brass_key\n+ {has brass_key} [Use the brass key] -> b\n@passage b B\nOpen.\n@end\n', 'k.md', 'structured');
    const take = project.passages[0].choices.find((c) => c.text === 'Take the brass key')!;
    take.review = 'pending';
    const d = analyze(project).diagnostics;
    expect(d.map((x) => x.code)).not.toContain('ITEM_NEVER_ACQUIRED');
    const hint = d.find((x) => x.code === 'ITEM_GIVEN_ONLY_BY_SUGGESTION')!;
    expect(hint.message).toContain('Take the brass key');
    expect(hint.entityId).toBe(take.id);
    const { pendingSuggestions } = await import('../src/core/adapt');
    expect(pendingSuggestions(project)).toBe(1);
    reviewAll(project, 'approved');
    expect(analyze(project).diagnostics.map((x) => x.code)).not.toContain('ITEM_GIVEN_ONLY_BY_SUGGESTION');
  });

  it('pins every engine integration to a tag or commit, not a branch', () => {
    for (const a of Object.values(ADAPTERS)) expect(a.integration.defaultRef, a.label).not.toMatch(/^(main|master|develop|HEAD)$/);
  });
});

describe('Unity export features', () => {
  const archive = async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await buildStory([{ fileName: s.fileName, text: s.text }], { mode: s.mode });
    reviewAll(project, 'approved');
    return project;
  };
  const unity = (story: ReturnType<typeof processProject>, extra: Record<string, unknown> = {}) =>
    ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'Archive', engineVersion: '6000.3.23f1', integrationRef: '2.0.0', includeDemo: true, ...extra });
  const file = (r: ExportResult, end: string) => {
    const f = r.files.find((x) => x.path.endsWith(end));
    return typeof f?.content === 'string' ? f.content : '';
  };

  it('exports locked choices as C# conditions, in plain words', async () => {
    const { conditionCs } = await import('../src/core/export/unity');
    expect(conditionCs({ type: 'has_item', itemId: 'key' })).toBe('GatedChoice.Has(r("has_key"))');
    expect(conditionCs({ type: 'not', condition: { type: 'compare', variableId: 'trust', op: '>=', value: 2.5 } })).toBe('!(GatedChoice.Compare(r("trust"), ">=", 2.5d))');
    expect(conditionCs({ type: 'or', conditions: [{ type: 'compare', variableId: 'mood', op: '==', value: 'calm' }, { type: 'compare', variableId: 'open', op: '!=', value: true }] })).toBe(
      '(GatedChoice.Compare(r("mood"), "==", "calm") || GatedChoice.Compare(r("open"), "!=", true))',
    );
    const r = await unity(processProject(await archive()));
    const info = file(r, 'Runtime/StoryInfo.cs');
    expect(info).toContain('new GatedChoice("archive_entry", "Open the archive", new GatedChoice.Requirement("Archive Key", r => GatedChoice.Has(r("has_archive_key"))))');
    expect(info).toMatch(/PassageTitles = \{ "[^"]+"/);
    for (const f of ['GatedChoice.cs', 'NarrativeSettings.cs', 'NarrativeCuePlayer.cs', 'SaveStorage.cs', 'NarrativeLocalization.cs', 'Editor/StoryDebuggerWindow.cs', 'Editor/PlaythroughRunner.cs', 'Tests/Editor/PlaythroughTests.cs'])
      expect(r.files.some((x) => x.path.endsWith(f)), f).toBe(true);
    // Image conversion decodes scene pictures; a minimal project needs it listed.
    expect(JSON.parse(file(r, '/package.json')).dependencies['com.unity.modules.imageconversion']).toBe('1.0.0');
  });

  it('turns cues into Ink tags, reads them back, and lists them for Unity', async () => {
    const { cueName, cueTag } = await import('../src/core/isr');
    expect([cueName('Music!'), cueName('speaker'), cueTag('shake', ' 0.5 # x')]).toEqual(['music', 'speaker_cue', 'shake:0.5 x']);
    const { project } = await build('@passage hall Hall\n@cue music calm\nThe hall is dark.\n@cue shake\n@end\n', 'c.md', 'structured');
    expect(project.passages[0].content.map((b) => b.type)).toEqual(['cue', 'action', 'cue']);
    const story = processProject(project);
    expect(story.generated.ink).toContain('# music:calm\nThe hall is dark.\n# shake\n');
    expect(story.state).toBe('Succeeded');
    const back = await buildStory([{ fileName: 'b.ink', text: story.generated.ink }], { mode: 'faithful' });
    expect(back.project.inkPassthrough).toBeUndefined();
    expect(back.project.passages[0].content.map((b) => (b.type === 'cue' ? `${b.name}:${b.value ?? ''}` : b.type))).toEqual(['music:calm', 'action', 'shake:']);
    const r = await unity(story);
    expect(file(r, 'Runtime/StoryInfo.cs')).toContain('Cues = { "music", "shake" }');
    expect(file(r, 'Runtime/StoryInfo.cs')).toContain('CueTags = { "music:calm", "shake" }');
  });

  it('finds playthrough routes to every ending, for the package’s tests', async () => {
    const { storyRoutes } = await import('../src/core/export/routes');
    const story = processProject(await archive());
    const routes = storyRoutes(story.compile.json!, story.project);
    expect(routes.map((r) => r.ending).sort()).toEqual(Object.keys(story.smoke!.endingsReached).sort());
    expect(storyRoutes(story.compile.json!, story.project)).toEqual(routes); // the same every export
    for (const r of routes) expect(r.lastLine.length).toBeGreaterThan(0);
    const r = await unity(story, { unityLayout: 'project' });
    expect(file(r, 'Editor/StoryRoutes.cs')).toContain(`new Route(${JSON.stringify(routes[0].name)}`);
    const manifest = JSON.parse(file(r, 'Packages/manifest.json'));
    expect(manifest.testables).toEqual([r.unityPackage!.name]);
    expect(manifest.dependencies['com.unity.test-framework']).toBeTruthy();
    expect(JSON.parse(file(r, '.Tests.asmdef')).defineConstraints).toEqual(['UNITY_INCLUDE_TESTS', 'NARRATIVE_BRIDGE_INK']);
  });

  it('keeps voice clips and pictures out of Resources with Addressables', async () => {
    const project = await archive();
    const line = project.passages.flatMap((p) => p.content).find((b) => b.type === 'dialogue')!;
    if (line.type === 'dialogue') line.audio = { id: 'clip_1', name: 'a.wav', mime: 'audio/wav' };
    project.passages[0].image = { id: 'img_1', name: 'a.png', mime: 'image/png', alt: '' };
    const media = { audio: { clip_1: { mime: 'audio/wav', bytes: new Uint8Array([1]) } }, images: { img_1: { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) } } };
    const story = processProject(project);
    const plain = await unity(story, media);
    expect(plain.files.some((f) => /Resources\/NarrativeBridge\/archive\/Audio\/clip_1\.wav$/.test(f.path))).toBe(true);
    expect(file(plain, 'Runtime/StoryInfo.cs')).toContain('UsesAddressables = false');
    const r = await unity(story, { ...media, unityAddressables: true, unityLayout: 'project' });
    expect(r.files.some((f) => f.path.endsWith('Runtime/StoryAssets/Audio/clip_1.wav'))).toBe(true);
    expect(r.files.some((f) => f.path.endsWith('Runtime/StoryAssets/Images/img_1.png.bytes'))).toBe(true);
    expect(r.files.some((f) => /Resources\/.*(clip_1|img_1)/.test(f.path))).toBe(false);
    expect(file(r, 'Runtime/StoryInfo.cs')).toContain('UsesAddressables = true');
    expect(JSON.parse(file(r, 'Packages/manifest.json')).dependencies['com.unity.addressables']).toBe('2.11.2');
  });

  it('writes a translation sheet whose keys match every line the story prints', async () => {
    const { translationKey, translationSheet, translationEntries, normaliseText } = await import('../src/core/export/translations');
    expect(normaliseText('  Rows of\n shelves  ')).toBe('Rows of shelves');
    expect(translationKey('Rows of shelves')).toBe(translationKey(' Rows  of\nshelves '));
    expect(translationKey('Rows of shelves')).toMatch(/^nb_[0-9a-f]{8}$/);
    const project = await archive();
    const story = processProject(project);
    const keys = new Set(translationEntries(project).map((e) => e.key));
    // Play the story the way the Unity controller reads it, and look every line, name and choice up.
    const { Story } = await import('inkjs/full');
    const ink = new Story(story.compile.json!);
    const missing: string[] = [];
    for (let step = 0; step < 50; step++) {
      while (ink.canContinue) {
        const raw = (ink.Continue() ?? '').trim();
        if (!raw) continue;
        const speaker = (ink.currentTags ?? []).some((t) => t.startsWith('speaker:'));
        const colon = raw.indexOf(': ');
        const parts = speaker && colon > 0 ? [raw.slice(0, colon), raw.slice(colon + 2)] : [raw];
        for (const p of parts) if (!keys.has(translationKey(p))) missing.push(p);
      }
      if (!ink.currentChoices.length) break;
      for (const c of ink.currentChoices) if (!keys.has(translationKey(c.text))) missing.push(c.text);
      ink.ChooseChoiceIndex(ink.currentChoices.length - 1);
    }
    expect(missing).toEqual([]);
    const sheet = translationSheet(project, undefined, ['fr', 'de']);
    expect(sheet.split('\r\n')[0]).toBe('key,kind,passage,source,fr,de');
    expect(translationSheet({ ...project, passages: [{ ...project.passages[0], content: [{ type: 'action', text: 'Say "hi", then go', origin: 'source' }], choices: [] }] })).toContain('"Say ""hi"", then go"');
    const r = await unity(story, { translationLanguages: ['fr'] });
    expect(file(r, 'Translations.csv').split('\r\n')[0]).toBe('key,kind,passage,source,fr');
  });
});

describe('cue sounds', () => {
  const withSounds = async () => {
    const { project } = await build('@passage hall Hall\n@cue music calm\nThe hall is dark.\n@cue sound door\n@cue shake\n@passage yard Yard\n@cue music calm\nRain.\n@cue music\n@end\n', 'c.md', 'structured');
    return project;
  };

  it('knows what each cue does and where the music stands', async () => {
    const { cueKind, cuesIn, backgroundAfter, cueWantsSound } = await import('../src/core/cues');
    expect(['music', 'stop_music', 'ambience', 'stop_ambience', 'shake', 'door_slam', 'song'].map(cueKind)).toEqual(['music', 'stop_music', 'ambience', 'stop_ambience', 'shake', 'sound', 'music']);
    expect(cuesIn(['speaker:mira', 'audio:x.wav', 'music:calm', 'transition', 'shake', 'image:a.png'])).toEqual([
      { name: 'music', value: 'calm', tag: 'music:calm' },
      { name: 'shake', value: '', tag: 'shake' },
    ]);
    const has = (t: string) => ['music:calm', 'music:storm', 'ambience:rain'].includes(t);
    const cues = cuesIn(['music:calm', 'ambience:rain', 'music:unknown', 'sound:door']);
    expect(backgroundAfter(cues, has)).toEqual({ music: 'music:calm', ambience: 'ambience:rain' }); // a track with no sound changes nothing
    expect(backgroundAfter([...cues, ...cuesIn(['music', 'stop_ambience'])], has)).toEqual({ music: null, ambience: null });
    expect([cueWantsSound('music', ''), cueWantsSound('music', 'calm'), cueWantsSound('shake', '1'), cueWantsSound('door', '')]).toEqual([false, true, false, true]);
  });

  it('shares a sound among cues with the same tag, and ships it everywhere', async () => {
    const { setCueSound, cueSounds, cuesWithTag } = await import('../src/core/cues');
    const { referencedAudio } = await import('../src/core/audio');
    const { storyFiles } = await import('../src/core/files');
    const { buildPlayableHtml } = await import('../src/core/export');
    const project = await withSounds();
    const calm = { id: 'cue_calm', name: 'calm.mp3', mime: 'audio/mpeg' };
    expect(cuesWithTag(project, 'music:calm')).toBe(2);
    setCueSound(project, 'music:calm', calm);
    setCueSound(project, 'sound:door', { id: 'cue_door', name: 'door.wav', mime: 'audio/wav' });
    expect(project.passages.flatMap((p) => p.content).filter((b) => b.type === 'cue' && b.audio?.id === 'cue_calm')).toHaveLength(2);
    expect([...cueSounds(project).keys()]).toEqual(['music:calm', 'sound:door']);
    expect(referencedAudio(project).map((a) => a.id)).toEqual(['cue_calm', 'cue_door']);
    expect(storyFiles(project).filter((f) => f.kind === 'cue sound').map((f) => f.fileName)).toEqual(['calm.mp3', 'door.wav']);
    const story = processProject(project);
    const audio = { cue_calm: { mime: 'audio/mpeg', bytes: new Uint8Array([1, 2]) }, cue_door: { mime: 'audio/wav', bytes: new Uint8Array([3]) } };
    const html = buildPlayableHtml(story, '/* ink */', audio);
    const meta = JSON.parse(/<script id="story-meta" type="application\/json">([^<]*)<\/script>/.exec(html)?.[1] ?? '{}');
    expect(meta.cueSounds).toEqual({ 'music:calm': 'cue_calm.mp3', 'sound:door': 'cue_door.wav' });
    expect(meta.hasClips).toBe(false); // cue sounds alone don't turn voices on
    expect(html).toContain('"cue_calm.mp3":"data:audio/mpeg;base64,');
    const r = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'Hall', engineVersion: '6000.3.23f1', integrationRef: '2.0.0', includeDemo: true, audio });
    const info = r.files.find((f) => f.path.endsWith('Runtime/StoryInfo.cs'))!.content as string;
    expect(info).toContain('CueSoundTags = { "music:calm", "sound:door" }');
    expect(info).toContain('CueSoundFiles = { "cue_calm.mp3", "cue_door.wav" }');
    expect(r.files.some((f) => f.path.endsWith('Resources/NarrativeBridge/hall/Audio/cue_calm.mp3'))).toBe(true);
    setCueSound(project, 'music:calm', undefined);
    expect(cueSounds(project).has('music:calm')).toBe(false);
  });
});

describe('translations brought back in', () => {
  const archive = async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await buildStory([{ fileName: s.fileName, text: s.text }], { mode: s.mode });
    reviewAll(project, 'approved');
    return project;
  };

  it('reads a filled-in sheet, keeps what it had, and says what changed', async () => {
    const { translationSheet, importTranslations, translationCoverage, translate, parseCsv, removeLanguage } = await import('../src/core/export/translations');
    const project = await archive();
    const sheet = parseCsv(translationSheet(project, undefined, ['fr']));
    // A translator fills in French for half the rows, in a spreadsheet that saves with semicolons.
    const filled = sheet.map((r, i) => (i === 0 ? r : [...r.slice(0, 4), i % 2 ? `FR ${r[3]}` : ''])).concat([['nb_00000000', 'line', 'gone', 'An old line', 'Une vieille ligne']]);
    const csv = filled.map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\n');
    const r = importTranslations(project, csv);
    const half = Math.ceil((sheet.length - 1) / 2);
    expect(r.languages).toEqual([{ code: 'fr', translated: half }]);
    expect(r.stale).toBe(1);
    expect(translate(project, 'fr', sheet[1][3])).toBe(`FR ${sheet[1][3]}`);
    expect(translate(project, '', sheet[1][3])).toBe(sheet[1][3]);
    // Bringing in a sheet with an empty cell keeps the earlier translation; the next sheet carries them.
    importTranslations(project, `key,kind,passage,source,fr\n${sheet[1][0]},,,x,\n`);
    expect(translate(project, 'fr', sheet[1][3])).toBe(`FR ${sheet[1][3]}`);
    expect(parseCsv(translationSheet(project))[1][4]).toBe(`FR ${sheet[1][3]}`);
    expect(translationCoverage(project).languages[0].translated).toBe(half);
    expect(() => importTranslations(project, 'a,b\n1,2\n')).toThrow(/key/);
    expect(() => importTranslations(project, 'key,kind,passage,source\nx,,,y\n')).toThrow(/language/);
    removeLanguage(project, 'fr');
    expect(project.translations).toBeUndefined();
  });

  it('puts translations and locked choices in the playable story', async () => {
    const { importTranslations, translationEntries, translationKey } = await import('../src/core/export/translations');
    const { buildPlayableHtml } = await import('../src/core/export');
    const project = await archive();
    const entries = translationEntries(project);
    importTranslations(project, ['key,kind,passage,source,de', ...entries.map((e) => `${e.key},,,"${e.source.replace(/"/g, '""')}","DE ${e.source.replace(/"/g, '""')}"`)].join('\n'));
    const html = buildPlayableHtml(processProject(project), '/* ink */');
    const meta = JSON.parse(/<script id="story-meta" type="application\/json">([^<]*)<\/script>/.exec(html)![1].replace(/\\u003c/g, '<'));
    expect(meta.translations.languages).toEqual(['de']);
    expect(meta.translations.strings[translationKey(entries[0].source)].de).toBe(`DE ${entries[0].source}`);
    expect(meta.gated).toEqual(expect.arrayContaining([expect.objectContaining({ p: 'archive_entry', t: 'Open the archive', needs: [{ w: 'Archive Key', c: { type: 'has_item', itemId: 'archive_key' } }] })]));
    // The page computes keys like translationKey does (spaces tidied, then FNV-1a).
    const pageKey = new Function(/function textKey\(text\) \{[\s\S]*?\n  \}/.exec(html)![0] + '; return textKey;')() as (t: string) => string;
    for (const e of entries) expect(pageKey(`  ${e.source.replace(/ /g, '   ')} `)).toBe(e.key);
  });

  it('warns about silent cues and cue names that look like typos', async () => {
    const { project } = await build('@passage hall Hall\n@cue music calm\nA.\n@cue musci calm\n@cue shake\n@cue lights_flicker\n@cue lights_flicker\n@cue light_flicker\n@end\n', 'c.md', 'structured');
    const codes = analyze(project).diagnostics.filter((d) => d.code.startsWith('CUE_'));
    expect(codes.filter((d) => d.code === 'CUE_WITHOUT_SOUND').map((d) => d.message)).toEqual([
      'The cue "music: calm" has no sound attached, so it\'s silent in Playtest and the playable story.',
      'The cue "musci: calm" has no sound attached, so it\'s silent in Playtest and the playable story.',
      'The cue "lights_flicker" has no sound attached (it\'s used 2 times), so it\'s silent in Playtest and the playable story.',
      'The cue "light_flicker" has no sound attached, so it\'s silent in Playtest and the playable story.',
    ]);
    expect(codes.filter((d) => d.code === 'CUE_NAME_TYPO').map((d) => d.message)).toEqual([
      'The cue "musci" looks like a typo for "music", so the game would treat it as a different cue.',
      'The cue "light_flicker" looks like a typo for "lights_flicker", so the game would treat it as a different cue.',
    ]);
  });

  it('ships the translation sheet and playthrough routes with Unreal', async () => {
    const r = await ADAPTERS.unreal.export(processProject(await archive()), { engine: 'unreal', projectName: 'Archive', engineVersion: '5.7', integrationRef: 'v1.42.21-release', includeDemo: true });
    const sheet = r.files.find((f) => f.path.endsWith('Content/NarrativeBridge/Data/Translations.csv'))!.content as string;
    expect(sheet.split('\r\n')[0]).toBe('key,kind,passage,source');
    // The story panel's own words are in the sheet too, as in the Unity package.
    expect(sheet).toContain(',interface,,Save to a slot');
    const routes = JSON.parse(r.files.find((f) => f.path.endsWith('StorySource/PlaythroughRoutes.json'))!.content as string).routes;
    expect(routes.length).toBeGreaterThan(0);
    expect(routes[0]).toHaveProperty('choices');
  });

  it('gives Unreal the locked choices, cues and exits, and text helpers for italics', async () => {
    const r = await ADAPTERS.unreal.export(processProject(await archive()), { engine: 'unreal', projectName: 'Archive', engineVersion: '5.7', integrationRef: 'v1.42.21-release', includeDemo: true });
    const info = r.files.find((f) => f.path.endsWith('NarrativeBridgeStoryInfo.h'))!.content as string;
    expect(info).toContain('1, TEXT("archive_entry"), TEXT("Open the archive"), TEXT("Archive Key"), false }');
    // Each locked choice's condition is C++ the component tests against the story's variables.
    expect(info).toContain('{ TEXT("Archive Key"), [](const FVariableReader& V) -> bool { return V.Has(TEXT("has_archive_key")); } }');
    expect(info).toMatch(/static const int32 NumGatedChoices = [1-9]/);
    expect(info).toContain('static const int32 NumReservedTags = ');
    expect(info).toContain('TEXT("speaker")');
    const cpp = r.files.find((f) => f.path.endsWith('NarrativeBridgeComponent.cpp'))!.content as string;
    expect(info).toContain('static const TCHAR* ExitPrefix = TEXT("Back to the game: ");');
    expect(cpp).toContain('OnCue.Broadcast(Name, Value)');
    expect(cpp).toContain('UNarrativeBridgeComponent::PlainText');
    // Inkpot's SetBool takes a third, out, argument.
    expect(cpp).not.toMatch(/SetBool\([^,)]*,[^,)]*\)/);
    const h = r.files.find((f) => f.path.endsWith('NarrativeBridgeComponent.h'))!.content as string;
    const api = ['void Resume();', 'void ResumeAt(const FString& Passage);', 'void StartAt(const FString& Passage);', 'FNarrativeCue OnCue;', 'FNarrativeWords OnExit;', 'FNarrativeVariable OnVariableChanged;', 'TArray<FNarrativeLockedChoice> GetLockedChoices() const;', 'bool TryLoadState(const FString& Save, FString& Error);', 'static FString RichText(const FString& Text);'];
    for (const fn of api) expect(h).toContain(fn);
    // Braces balance in the generated C++ (a cheap check without an Unreal build).
    for (const src of [info, cpp, h]) expect(src.split('{').length).toBe(src.split('}').length);
  });

  it('gives Unreal the story panel, its look, an editor module and automation tests', async () => {
    const opts = { engine: 'unreal' as const, projectName: 'Archive', engineVersion: '5.7', integrationRef: 'v1.42.21-release' };
    const r = await ADAPTERS.unreal.export(processProject(await archive()), { ...opts, includeDemo: true, unityTheme: { preset: 'night' } as never });
    const file = (end: string) => r.files.find((f) => f.path.endsWith(end))?.content as string;
    // The look chosen on the Export page, under the C++ property names, colours in linear space.
    const theme = JSON.parse(file('Content/NarrativeBridge/Data/Theme.json'));
    expect(theme.Preset).toBe('night');
    expect(theme.bShowSpeakers).toBe(true);
    expect(theme.Background).toEqual({ R: expect.any(Number), G: expect.any(Number), B: expect.any(Number), A: 1 });
    expect(file('NarrativeTheme.h')).toContain('bool bShowLockedChoices = true;');
    // Float literals always have a decimal point (1.0f; 1f isn't C++).
    expect(file('NarrativeTheme.h')).not.toMatch(/[^.\d\w]\d+f[;,)]/);
    // Two modules: the game and its editor tools, which hold the tests.
    const uproject = JSON.parse(file('Archive.uproject'));
    expect(uproject.Modules.map((m: { Name: string; Type: string }) => m.Name + ':' + m.Type)).toEqual(['Archive:Runtime', 'ArchiveEditor:Editor']);
    expect(file('ArchiveEditor.Target.cs')).toContain('ExtraModuleNames.Add("ArchiveEditor");');
    expect(file('Archive.Build.cs')).toContain('"UMG"');
    expect(file('NarrativeBridgeRoutes.h')).toMatch(/static const int32 NumRoutes = [1-9]/);
    const tests = file('NarrativeBridgeTests.cpp');
    for (const t of ['"NarrativeBridge.Playthrough"', '"NarrativeBridge.StartAtEveryPassage"', '"NarrativeBridge.Saves"', '"NarrativeBridge.TranslationKeys"']) expect(tests).toContain(t);
    expect(tests).toContain('UNarrativeLocalization::Key(TEXT("The lamp is out.")), FString(TEXT("nb_');
    // Press Play: the demo game mode, and the story's files cooked and staged with the game.
    expect(file('Config/DefaultEngine.ini')).toContain('GlobalDefaultGameMode=/Script/Archive.NarrativeDemoGameMode');
    expect(file('Config/DefaultGame.ini')).toContain('+DirectoriesToAlwaysCook=(Path="/Game/NarrativeBridge")');
    for (const f of ['NarrativeStoryWidget.cpp', 'NarrativeStoryPanel.cpp', 'NarrativeCuePlayer.cpp', 'NarrativeLocalization.cpp', 'NarrativeSettings.cpp', 'NarrativeStoryTrigger.cpp', 'NarrativeSimpleInventory.h', 'NarrativeDemoGameMode.cpp']) expect(file(f), f).toBeTruthy();
    for (const f of r.files.filter((x) => /\.(h|cpp)$/.test(x.path))) {
      const src = f.content as string;
      expect(src.split('{').length, f.path).toBe(src.split('}').length);
      expect(src, f.path).not.toContain('__API__');
    }
    const plain = await ADAPTERS.unreal.export(processProject(await archive()), { ...opts, includeDemo: false });
    expect(plain.files.some((f) => f.path.endsWith('NarrativeDemoGameMode.cpp'))).toBe(false);
    expect(plain.files.find((f) => f.path.endsWith('Config/DefaultEngine.ini'))!.content).not.toContain('GlobalDefaultGameMode');
  });
});

describe('comparing drafts', () => {
  it('lines up two versions line by line', () => {
    expect(diffLines(['a', 'b', 'c', 'd'], ['a', 'c', 'x', 'd'])).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'd' },
    ]);
    expect(diffLines([], ['a'])).toEqual([{ kind: 'added', text: 'a' }]);
  });

  it('says which passages, lines and choices changed', async () => {
    const before = (await build(SAMPLES[0].text, SAMPLES[0].fileName, SAMPLES[0].mode)).project;
    const after = structuredClone(before);
    const [first, second] = after.passages;
    first.title = 'A new name';
    const said = first.content.findIndex((b) => b.type === 'dialogue' || b.type === 'action');
    const old = first.content[said] as { text: string };
    old.text = 'Something else entirely.';
    after.passages = after.passages.filter((p) => p !== second);
    after.passages.push({ ...structuredClone(first), id: 'brand_new', title: 'Brand new', choices: [] });
    const c = compareProjects(before, after);
    const changed = c.passages.find((p) => p.id === first.id)!;
    // Just the line: choices name passages by their title now, so the rename doesn't show up in them.
    expect(changed).toMatchObject({ status: 'changed', oldTitle: before.passages[0].title, added: 1, removed: 1 });
    expect(changed.lines.find((l) => l.kind === 'added')!.text).toContain('Something else entirely.');
    expect(c.passages.find((p) => p.id === second.id)!.status).toBe('removed');
    expect(c.passages.find((p) => p.id === 'brand_new')!.status).toBe('added');
    expect(c.unchanged).toBe(before.passages.length - 2);
    expect(compareProjects(before, before).passages).toEqual([]);
  });
});

describe('italics and bold', () => {
  it('turns Fountain and Markdown emphasis into tags, and back', () => {
    expect(markupToTags('A *quiet* **loud** ***both*** _under_ \\*star\\* 2*3*4 snake_case_name')).toBe('A <i>quiet</i> <b>loud</b> <b><i>both</i></b> <u>under</u> *star* 2*3*4 snake_case_name');
    expect(markupToTags('__strong__ and _soft_', 'markdown')).toBe('<b>strong</b> and <i>soft</i>');
    expect(tagsToFountain('A <i>quiet</i> <b>loud</b> *star*')).toBe('A *quiet* **loud** \\*star\\*');
    expect(markupToTags(tagsToFountain('<b><i>both</i></b> and <u>u</u>'))).toBe('<b><i>both</i></b> and <u>u</u>');
  });

  it('shows emphasis safely, and counts and speaks the plain text', () => {
    expect(emphasisHtml('<i>a</i> <script>x</script> <b>&</b>')).toBe('<em>a</em> &lt;script&gt;x&lt;/script&gt; <strong>&amp;</strong>');
    expect(plainText('The <i>storm</i> <b>took</b> it')).toBe('The storm took it');
    expect(countWords('The <i>storm</i> took it')).toBe(4);
  });

  it('keeps emphasis from Fountain, Final Draft and Twine all the way to the Ink', async () => {
    const { project } = await build('INT. ROOM - DAY\n\nThe *storm* took the **lens**.\n\nMIRA\nI _told_ you.\n');
    const texts = project.passages.flatMap((p) => p.content.map((b) => ('text' in b ? b.text : '')));
    expect(texts).toEqual(expect.arrayContaining(['The <i>storm</i> took the <b>lens</b>.', 'I <u>told</u> you.']));
    const ink = processProject(project).generated.ink;
    expect(ink).toContain('The <i>storm</i> took the <b>lens</b>.');
    const fdx = fdxToFountain('<FinalDraft><Content><Paragraph Type="Action"><Text>A </Text><Text Style="Italic">quiet</Text><Text> room.</Text></Paragraph></Content></FinalDraft>');
    expect(fdx).toBe('A *quiet* room.\n');
  });
});

describe('second website review fixes', () => {
  it('escapes Ink keywords at the start of a line, so the story still builds', async () => {
    for (const word of ['VAR x = 1', 'CONST y = 2', 'LIST colours = red', 'EXTERNAL f()', 'INCLUDE other.ink', 'TODO: later'])
      expect(escapeInk(word)).toBe(`\\${word}`);
    expect(escapeInk('VARIOUS things')).toBe('VARIOUS things');
    const text = 'INT. HALL - NIGHT\n\nVAR x = 1\n\nLIST colours = red\n\nINCLUDE other.ink\n\nEXTERNAL f()\n';
    const story = processProject((await build(text)).project);
    expect(story.compile.ok).toBe(true);
    expect(story.generated.ink).toContain('\\INCLUDE other.ink');
  });

  it('says what an Ink compiler message means, with the line', () => {
    const d = compileInk('Hello\nINCLUDE other.ink\n-> END').diagnostics[0];
    expect(d.message).toMatch(/^A line starting with INCLUDE asks Ink to read another file.*The line: “INCLUDE other.ink”/);
    expect(d.details?.inkLine).toBe(2);
    expect(compileInk('Hi\n-> nowhere').diagnostics[0].message).toMatch(/^A “->” leads to a passage that doesn’t exist/);
  });

  it('keeps V.O. and O.S. in the Ink, the recording script and Twine', async () => {
    const { buildRecordingScript, buildTwee } = await import('../src/core/export');
    const { voiceExtension } = await import('../src/core/builder');
    expect(['(V.O.)', '(vo)', '(O. S.)', '(O.C.)', "(CONT'D)"].map(voiceExtension)).toEqual(['V.O.', 'V.O.', 'O.S.', 'O.C.', undefined]);
    const text = 'INT. STATION - NIGHT\n\nPORTER (V.O.)\nLast train.\n\nMIRA (O.S.)\n(quietly)\nWait!\n\nPORTER\nToo late.\n';
    const { project } = await build(text);
    expect(project.characters.map((c) => c.displayName)).toEqual(['PORTER', 'MIRA']);
    const story = processProject(project);
    expect(story.generated.ink).toContain('PORTER (V.O.): Last train. #speaker:porter #ext:V.O.');
    expect(story.generated.ink).toContain('MIRA (O.S.): Wait! #speaker:mira #ext:O.S. #paren:quietly');
    expect(story.generated.ink).toContain('PORTER: Too late. #speaker:porter\n');
    expect(buildRecordingScript(project)).toContain('MIRA,"O.S., quietly",Wait!');
    expect(buildTwee(story, 'plain')).toContain('PORTER (V.O.): Last train.');
    // Ink comes back with the extension, and it isn't taken for a cue.
    const back = (await build(story.generated.ink, 'story.ink', 'structured')).project;
    const lines = back.passages[0].content.filter((b) => b.type === 'dialogue');
    expect(lines.map((b) => b.type === 'dialogue' && b.extension)).toEqual(['V.O.', 'O.S.', undefined]);
    expect(back.passages[0].content.some((b) => b.type === 'cue')).toBe(false);
  });

  it("treats the script's own THE END as the ending, so it isn't shown twice", async () => {
    const { buildTwee } = await import('../src/core/export');
    const { project } = await build('INT. HALL - NIGHT\n\nThe lamp goes out.\n\n> THE END <\n');
    const last = project.passages[0].content.at(-1)!;
    expect(last).toMatchObject({ type: 'note', text: "The script's ending: THE END" });
    const story = processProject(project);
    expect(story.generated.ink).not.toMatch(/^THE END$/m);
    expect(buildTwee(story, 'plain')).not.toMatch(/^THE END$/m);
    // Only an ending's last line counts; a passage that is just "THE END" keeps it.
    expect((await build('INT. HALL - NIGHT\n\nTHE END\n')).project.passages[0].content.map((b) => b.type)).toEqual(['action']);
  });

  it('keeps underscores inside words, accents and other scripts in names', async () => {
    const { pascalCase } = await import('../src/core/export/common');
    const { packageSlug } = await import('../src/core/export/unityPackage');
    const { fileBase } = await import('../src/core/isr');
    const { project } = await build('Title: not_a_knot\n\nINT. HALL - NIGHT\n\nHello.\n');
    expect(project.project.title).toBe('not_a_knot');
    expect((await build('Title: _Underlined_ Title\n\nINT. HALL - NIGHT\n\nHello.\n')).project.project.title).toBe('Underlined Title');
    expect(pascalCase('Café Noir')).toBe('CafeNoir');
    expect(packageSlug('Café Noir')).toBe('cafe-noir');
    const tokyo = (await build('Title: 東京の夜\n\nINT. HALL - NIGHT\n\nHello.\n')).project;
    expect(tokyo.project.id).toMatch(/^story_[0-9a-f]{6}$/);
    expect(pascalCase('東京の夜')).toMatch(/^Story[0-9A-F]{6}$/);
    expect(packageSlug('東京の夜')).toMatch(/^story-[0-9a-f]{6}$/);
    expect(packageSlug('東京の夜')).not.toBe(packageSlug('大阪の朝'));
    expect(fileBase(project)).toBe('not-a-knot');
  });

  it('names every export the same way', async () => {
    const { playableFileName, recordingScriptFileName, twineFileName } = await import('../src/core/export');
    const { project } = await build('Title: The Last Train\n\nINT. HALL - NIGHT\n\nHello.\n');
    const story = processProject(project);
    expect([playableFileName(story), recordingScriptFileName(project), twineFileName(story)]).toEqual(['the-last-train.html', 'the-last-train-recording-script.csv', 'the-last-train.twee']);
  });
});

describe('live design safety', () => {
  it('drops anything in a live design that would load from another site', async () => {
    const { withoutRemoteLoads } = await import('../src/ui/design/live');
    const { normaliseDesign } = await import('../src/ui/design/design');
    const doc = normaliseDesign({
      format: 'narrative-bridge-design',
      tokens: { '--paper': 'url(https://tracker.example/p.png) repeat', '--grain': 'url("data:image/png;base64,AAAA")', '--radius': '8px' },
      rules: { '.app': { background: 'url(//cdn.example/x.jpg)' } },
      css: '@import url("https://fonts.example/a.css");\n.x { background: url( https://e.example/y ) }',
    });
    const safe = withoutRemoteLoads(doc);
    expect(safe.tokens).toEqual({ '--paper': 'none repeat', '--grain': 'url("data:image/png;base64,AAAA")', '--radius': '8px' });
    expect(safe.rules['.app'].background).toBe('none');
    expect(safe.css).not.toMatch(/example/);
  });
});

describe('new scenes from the Graph', () => {
  const script = 'INT. HALL - NIGHT\n\nThe hall is dark.\n\nINT. ROOM - NIGHT\n\nA lamp burns.\n\nINT. ATTIC - NIGHT\n\nDust everywhere.\n';
  const load = async () => (await build(script)).project;

  it('puts a scene straight after a passage, between it and where it went', async () => {
    const { addScene } = await import('../src/ui/projectOps');
    const p = await load();
    expect(p.passages.map((x) => [x.id, x.divert])).toEqual([['hall', 'room'], ['room', 'attic'], ['attic', undefined]]);
    const s = addScene(p, { title: 'The Stairs', heading: 'INT. STAIRS - NIGHT', firstLine: 'The steps creak.', from: 'hall', link: 'continue' });
    if (typeof s === 'string') throw new Error(s);
    expect(s).toMatchObject({ id: 'the_stairs', sceneHeading: 'INT. STAIRS - NIGHT', divert: 'room', isEnding: false, origin: 'user_authored' });
    expect(s.content).toEqual([{ type: 'action', text: 'The steps creak.', origin: 'user_authored' }]);
    expect(p.passages.map((x) => x.id)).toEqual(['hall', 'the_stairs', 'room', 'attic']);
    expect(p.passages[0].divert).toBe('the_stairs');
    const story = processProject(p);
    expect(story.compile.ok).toBe(true);
    expect(story.generated.ink).toMatch(/=== the_stairs ===[\s\S]*The steps creak\. #scene:INT\. STAIRS - NIGHT\n-> room/);
    // After the last passage, the new scene becomes the ending.
    const end = addScene(p, { title: 'Roof', from: 'attic', link: 'continue' });
    expect(end).toMatchObject({ isEnding: true });
    expect(p.passages.find((x) => x.id === 'attic')).toMatchObject({ divert: 'roof', isEnding: false });
  });

  it('adds a scene as a new choice, keeping the way the passage already went', async () => {
    const { addScene } = await import('../src/ui/projectOps');
    const p = await load();
    const s = addScene(p, { title: 'Cellar', from: 'hall', link: 'choice', choiceText: 'Go down to the cellar', keepPathText: 'Go into the room', then: 'attic' });
    if (typeof s === 'string') throw new Error(s);
    const hall = p.passages[0];
    expect(hall.divert).toBeUndefined();
    expect(hall.choices.map((c) => [c.text, c.target])).toEqual([['Go into the room', 'room'], ['Go down to the cellar', 'cellar']]);
    expect(s.divert).toBe('attic');
    const story = processProject(p);
    expect(story.compile.ok).toBe(true);
    expect(story.analysis.graph.nodes.find((n) => n.id === 'cellar')?.reachable).toBe(true);
    // A passage that already has choices just gets one more.
    addScene(p, { title: 'Garden', from: 'hall', link: 'choice' });
    expect(hall.choices.map((c) => c.text)).toEqual(['Go into the room', 'Go down to the cellar', 'Garden']);
  });

  it('adds a scene on its own at a place on the map, and explains what it can’t do', async () => {
    const { addScene } = await import('../src/ui/projectOps');
    const p = await load();
    const s = addScene(p, { title: 'Dream', link: 'none', at: { x: 400.4, y: 90.6 } });
    expect(s).toMatchObject({ id: 'dream', isEnding: true });
    expect(p.layout?.dream).toEqual({ x: 400, y: 91 });
    expect(processProject(p).analysis.graph.nodes.find((n) => n.id === 'dream')?.reachable).toBe(false);
    expect(addScene(p, { title: ' ', link: 'none' })).toBe('Give the scene a title.');
    expect(addScene(p, { title: 'X', link: 'continue' })).toBe('Choose the passage it comes after.');
    addScene(p, { title: 'Y', from: 'room', link: 'choice' });
    expect(addScene(p, { title: 'Z', from: 'room', link: 'continue' })).toMatch(/ends with choices/);
    // Titles that are already used get their own id.
    expect(addScene(p, { title: 'Dream', link: 'none' })).toMatchObject({ id: 'dream_2' });
  });
});

describe('new scenes elsewhere in the app', () => {
  const script = 'INT. HALL - NIGHT\n\nThe hall is dark.\n\nINT. ROOM - NIGHT\n\nA lamp burns.\n';

  it('creates a passage a choice already leads to, under that name', async () => {
    const { addScene, addChoice } = await import('../src/ui/projectOps');
    const { sceneFix } = await import('../src/ui/NewScene');
    const { project: p } = await build(script);
    const c = addChoice(p, 'hall')!;
    c.target = 'boat_house';
    const before = processProject(p);
    const missing = before.diagnostics.find((d) => d.code === 'INK_TARGET_MISSING')!;
    const fix = sceneFix(missing.code, missing.details, missing.entityId, p)!;
    expect(fix.label).toBe('Create “Boat House”');
    expect(fix.request).toMatchObject({ id: 'boat_house', title: 'Boat House' });
    const s = addScene(p, { ...fix.request, title: fix.request.title!, link: 'none' });
    expect(s).toMatchObject({ id: 'boat_house', isEnding: true });
    const after = processProject(p);
    expect(after.diagnostics.some((d) => d.code === 'INK_TARGET_MISSING')).toBe(false);
    expect(after.compile.ok).toBe(true);
    // A name that's taken or not a passage name is explained.
    expect(addScene(p, { title: 'X', id: 'room', link: 'none' })).toMatch(/already a passage called “room”/);
    expect(addScene(p, { title: 'X', id: 'END', link: 'none' })).toMatch(/can’t be a passage name/);
  });

  it('points an existing choice, or a passage’s "then", at a new scene', async () => {
    const { addScene, addChoice } = await import('../src/ui/projectOps');
    const { project: p } = await build(script);
    const c = addChoice(p, 'hall')!;
    const s = addScene(p, { title: 'Cellar', link: 'none', retarget: { passageId: 'hall', choiceId: c.id } });
    if (typeof s === 'string') throw new Error(s);
    expect(p.passages[0].choices[0].target).toBe('cellar');
    expect(p.passages.map((x) => x.id)).toEqual(['hall', 'cellar', 'room']);
    const t = addScene(p, { title: 'Porch', link: 'none', retarget: { passageId: 'room' }, then: 'END' });
    expect(t).toMatchObject({ isEnding: true });
    expect(p.passages.find((x) => x.id === 'room')).toMatchObject({ divert: 'porch', isEnding: false });
    expect(processProject(p).compile.ok).toBe(true);
    expect(addScene(p, { title: 'Gone', link: 'none', retarget: { passageId: 'hall', choiceId: 'nope' } })).toBe('The choice it was for no longer exists.');
  });

  it('offers a scene after a passage where the reader gets stuck', async () => {
    const { sceneFix } = await import('../src/ui/NewScene');
    const { project: p } = await build(script);
    p.passages[1].isEnding = false;
    const stuck = processProject(p).diagnostics.find((d) => d.code === 'NO_AVAILABLE_CHOICES')!;
    expect(sceneFix(stuck.code, stuck.details, stuck.entityId, p)).toEqual({ label: 'Add a scene after it', request: { from: 'room', link: 'continue' } });
    expect(sceneFix('EMPTY_PASSAGE', undefined, 'room', p)).toBeNull();
  });
});

describe('readable story maps', () => {
  // A short branching story: a choice in the hall leads on directly or by way of a detour; a loop goes back.
  const story = `@start hall

@passage hall Hall

INT. HALL - NIGHT

The hall.

* [Go straight to the attic] -> attic
* [Take the stairs] -> stairs

@passage stairs Stairs

The stairs.

-> landing

@passage landing Landing

The landing.

* [Go up] -> attic
* [Go back down] -> hall

@passage attic Attic

INT. ATTIC - NIGHT

The attic.

* [Leave] -> roof

@passage roof Roof

The roof.

@end
`;
  const load = async () => {
    const { project } = await build(story, 'story.md', 'structured');
    return { project, graph: processProject(project, [], { skipSmoke: true }).analysis.graph };
  };

  it('puts each passage after everything that leads into it, and loops back become stubs', async () => {
    const { storyLayout, loopRoutes } = await import('../src/core/layout');
    const { graph } = await load();
    const pos = storyLayout(graph, 'hall');
    const col = (id: string) => pos.get(id)!.x;
    // The attic comes after the landing (its longest way in), not beside the stairs (its shortest).
    expect(col('hall') < col('stairs') && col('stairs') < col('landing') && col('landing') < col('attic') && col('attic') < col('roof')).toBe(true);
    expect([...loopRoutes(graph, 'hall')]).toEqual(['landing>hall']);
    // Every other route goes forward.
    for (const e of graph.edges) if (e.from !== 'landing' || e.to !== 'hall') expect(col(e.to)).toBeGreaterThan(col(e.from));
    // The same story always gets the same map.
    expect([...storyLayout(graph, 'hall')]).toEqual([...pos]);
  });

  it('groups passages into scenes and folds a scene into one card', async () => {
    const { sceneGroups, foldGraph } = await import('../src/core/scenes');
    const { project, graph } = await load();
    const groups = sceneGroups(project);
    expect(groups.map((g) => [g.id, g.members])).toEqual([
      ['hall', ['hall', 'stairs', 'landing']],
      ['attic', ['attic', 'roof']],
    ]);
    const { graph: f, of } = foldGraph(graph, groups, new Set(['hall']));
    expect(f.nodes.map((n) => n.id)).toEqual(['scene:hall', 'attic', 'roof']);
    expect(f.nodes[0]).toMatchObject({ title: 'Hall (3 passages)', isStart: true });
    expect(of.get('landing')).toBe('scene:hall');
    // Routes inside the scene are left out; the two ways into the attic become one.
    expect(f.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['scene:hall>attic', 'attic>roof']);
    expect(foldGraph(graph, groups, new Set()).graph).toBe(graph);
  });

  it('traces every way from the start to a passage', async () => {
    const { traceRoutes } = await import('../src/core/scenes');
    const { graph } = await load();
    const t = traceRoutes(graph.edges, 'hall', 'attic');
    expect([...t.nodes].sort()).toEqual(['attic', 'hall', 'landing', 'stairs']);
    expect(t.edges.size).toBe(5); // both ways to the attic, and the loop back that can still reach it
    expect(traceRoutes(graph.edges, 'roof', 'hall').nodes.size).toBe(0);
  });
});

describe('story outline', () => {
  it('finds where a choice\'s branches meet again, so the outline carries on from there', async () => {
    const { meetingPoints } = await import('../src/ui/StoryOutline');
    const { project } = await build(
      `@start alley

@passage alley Alley

The alley.

* [Gate] -> gate
* [Ear] -> ear

@passage gate Gate

The gate.

-> night

@passage ear Ear

The ear.

-> night

@passage night Night

The night.

* [Stay] -> stay
* [Run] -> run

@passage stay Stay

You stay.

@end

@passage run Run

You run.

@end
`,
      'story.md',
      'structured',
    );
    // The alley's two branches meet at the night; the night's never meet again (each ends).
    expect([...meetingPoints(project)]).toEqual([['alley', 'night']]);
  });
});

describe('forced choices', () => {
  const story = `@item brass_key "Brass Key"
@start cottage

@passage cottage Cottage

A key glints on the mantel.

* [Take the key] -> hall @give brass_key
* [Leave it] -> hall

@passage hall Hall

A locked door, and a staircase.

+ {has brass_key} [Open the door with the key] -> vault @forced
+ [Climb the stairs] -> attic
+ [Wait] -> attic

@passage vault Vault

Inside.

@end

@passage attic Attic

Dust.

@end
`;

  it('makes the forced choice the only one once its condition holds', async () => {
    const { Story } = await import('inkjs');
    const { project } = await build(story, 'story.md', 'structured');
    expect(project.passages.find((p) => p.id === 'hall')!.choices.map((c) => !!c.forced)).toEqual([true, false, false]);
    const s = processProject(project);
    expect(s.compile.ok).toBe(true);
    expect(s.generated.ink).toContain('+ {has_brass_key} [Open the door with the key] // forced');
    expect(s.generated.ink).toContain('+ {not has_brass_key} [Climb the stairs]');
    const play = (pick: number) => {
      const st = new Story(s.compile.json!);
      st.ContinueMaximally();
      st.ChooseChoiceIndex(pick);
      st.ContinueMaximally();
      return st.currentChoices.map((c) => c.text);
    };
    expect(play(0)).toEqual(['Open the door with the key']); // took the key: forced
    expect(play(1)).toEqual(['Climb the stairs', 'Wait']); // left it
  });

  it('comes back from Ink unchanged, keeps other choices’ own conditions, and the first forced choice wins', async () => {
    const { generateInk } = await import('../src/core/inkgen');
    const { choiceGuards } = await import('../src/core/forced');
    const { project } = await build(story, 'story.md', 'structured');
    const hall = project.passages.find((p) => p.id === 'hall')!;
    // A second forced choice, and an ordinary choice with a condition of its own.
    hall.choices.push({ ...hall.choices[1], id: 'hall_rest', text: 'Rest', forced: true, conditions: [{ type: 'compare', variableId: 'tired', op: '==', value: true }] });
    project.variables.push({ id: 'tired', initial: false, origin: 'source' } as never);
    hall.choices[2].conditions = [{ type: 'not', condition: { type: 'has_item', itemId: 'lamp' } }];
    project.items.push({ id: 'lamp', displayName: 'Lamp', consumable: false, origin: 'source' });
    const guards = choiceGuards(hall);
    expect(guards.get(hall.choices[0].id)).toEqual([]); // first forced: nothing over it
    expect(guards.get('hall_rest')!.length).toBe(1); // the second gives way to the first
    expect(guards.get(hall.choices[1].id)!.length).toBe(2);
    const ink = generateInk(project).ink;
    expect(processProject(project).compile.ok).toBe(true);
    const back = (await build(ink, 'story.ink', 'structured')).project;
    const strip = (x: string) => x.replace(/ \(source line \d+\)/g, '');
    expect(strip(generateInk(back).ink)).toBe(strip(ink));
    expect(back.passages.find((p) => p.id === 'hall')!.choices.map((c) => [c.text, !!c.forced, c.conditions.length])).toEqual([
      ['Open the door with the key', true, 1],
      ['Climb the stairs', false, 0],
      ['Wait', false, 1],
      ['Rest', true, 1],
    ]);
  });

  it('shows nothing as locked while a forced choice is on offer, and warns when one has no condition', async () => {
    const { lockedChoices } = await import('../src/core/gating');
    const { project } = await build(story, 'story.md', 'structured');
    const hall = project.passages.find((p) => p.id === 'hall')!;
    hall.choices[2].conditions = [{ type: 'has_item', itemId: 'brass_key' }, { type: 'compare', variableId: 'x', op: '>', value: 1 }];
    const read = (n: string) => (n === 'has_brass_key' ? true : 0);
    expect(lockedChoices(project, 'hall', read, ['Open the door with the key'])).toEqual([]);
    expect(lockedChoices(project, 'hall', read, ['Climb the stairs']).map((l) => l.choice.text)).toEqual(['Wait']);
    hall.choices[0].conditions = [];
    expect(processProject(project).diagnostics.some((d) => d.code === 'FORCED_WITHOUT_CONDITION')).toBe(true);
    expect(processProject(project).analysis.graph.edges.find((e) => e.id === hall.choices[0].id)?.forced).toBeUndefined();
  });

  it('carries forced choices into the playable page, Twine, Unity and Unreal', async () => {
    const { buildTwee, buildPlayableHtml } = await import('../src/core/export');
    const { project } = await build(story, 'story.md', 'structured');
    const s = processProject(project);
    expect(buildTwee(s, 'sugarcube')).toMatch(/<<if not \$has_brass_key>>\[\[Climb the stairs/);
    expect(buildPlayableHtml(s, '/* runtime */')).toContain('"f":1');
    const opts = { engineVersion: '6000.3', integrationRef: 'v1.21.0', includeDemo: true };
    const unity = await ADAPTERS.unity.export(s, { engine: 'unity', projectName: 'P', ...opts });
    expect(unity.files.find((f) => f.path.endsWith('StoryInfo.cs'))!.content).toContain('ForcedChoices = { "hall\\nOpen the door with the key" }');
    const unreal = await ADAPTERS.unreal.export(s, { engine: 'unreal', projectName: 'P', ...opts, engineVersion: '5.7' });
    expect(unreal.files.find((f) => f.path.endsWith('NarrativeBridgeStoryInfo.h'))!.content).toContain('"Open the door with the key"), TEXT("Brass Key"), true }');
  });
});

describe('players see only the dialogue', () => {
  const script = `INT. LIGHTHOUSE - NIGHT

Rain lashes the glass.

MARA
(whispering)
Did you hear that?

TOM
Only the wind.

CUT TO:
`;
  const lines = async (project: StoryProject) => {
    const { Story } = await import('inkjs');
    const s = processProject(project);
    expect(s.compile.ok).toBe(true);
    const st = new Story(s.compile.json!);
    return { text: st.ContinueMaximally(), tags: st.currentTags ?? [], ink: s.generated.ink, s };
  };

  it('leaves narration, transitions, scene headings and parentheticals out of what players get', async () => {
    const { project } = await build(script);
    const before = await lines(project);
    expect(before.text).toContain('Rain lashes the glass.');
    expect(before.ink).toContain('#scene:INT. LIGHTHOUSE - NIGHT');
    expect(before.ink).toContain('#paren:whispering');

    project.presentation = { dialogueOnly: true };
    const after = await lines(project);
    expect(after.text.trim().split('\n')).toEqual(['MARA: Did you hear that?', 'TOM: Only the wind.']);
    expect(after.ink).not.toMatch(/#scene:|#paren:|#transition/);
    // The developer can still read what was left out.
    expect(after.ink).toContain('// Players don’t see this: Rain lashes the glass.');
    expect(after.ink).toContain('// Players don’t see this: INT. LIGHTHOUSE - NIGHT');
    // The story itself is unchanged: turning it off brings everything back.
    expect(project.passages[0].content.some((b) => b.type === 'action')).toBe(true);
  });

  it('applies to Twine and the translation sheet, and drops a Continue with nothing before it', async () => {
    const { buildTwee } = await import('../src/core/export');
    const { translationEntries } = await import('../src/core/export/translations');
    const { forPlayers } = await import('../src/core/players');
    const { project } = await build(script);
    project.presentation = { dialogueOnly: true };
    const twee = buildTwee(processProject(project), 'sugarcube');
    const story = twee.slice(twee.indexOf(':: Lighthouse'));
    const shown = story.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^::.*$/m, '');
    expect(shown).toContain('Did you hear that?');
    expect(shown).not.toMatch(/Rain lashes|LIGHTHOUSE|CUT TO|whispering/);
    expect(story).toContain('Players don’t see this: Rain lashes the glass.');
    expect(translationEntries(project).map((e) => e.source)).not.toContain('Rain lashes the glass.');
    const p = project.passages[0];
    p.content = [{ type: 'action', text: 'Silence.', origin: 'source' }, { type: 'pause', origin: 'source' }, ...p.content, { type: 'pause', origin: 'source' }];
    const kinds = forPlayers(project).passages[0].content.map((b) => b.type).filter((t) => t !== 'note');
    expect(kinds[0]).toBe('dialogue'); // the first Continue had nothing before it
    expect(kinds.at(-1)).toBe('pause'); // the last follows dialogue, so it stays
  });
});

describe('starting at a line of dialogue', () => {
  const src = `@item flowers "Flowers"\n@passage garden Garden\nMARA: Do you like flowers?\n@pause\nMARA: Could you bring me some?\n@exit get_flowers The player goes to pick flowers\nMARA: You found them!\n@take flowers\nMARA: You found them!\n+ [Goodbye] -> END\n`;

  it('labels every dialogue line in Ink and adds an entry knot a game can start at', async () => {
    const { lineEntries } = await import('../src/core/lines');
    const { project } = await build(src, 'g.md', 'structured');
    const story = processProject(project);
    expect(story.compile.ok).toBe(true);
    const lines = lineEntries(project);
    // The label comes from the speaker and the words; the same line twice gets a number.
    expect(lines.map((l) => l.path)).toEqual(['garden.line_mara_do_you_like_flowers', 'garden.line_mara_could_you_bring_me_some', 'garden.line_mara_you_found_them', 'garden.line_mara_you_found_them_2']);
    expect(lines[2].display).toBe('MARA: You found them!');
    expect(story.generated.ink).toContain('- (line_mara_could_you_bring_me_some) MARA: Could you bring me some? #speaker:mara');
    expect(story.generated.ink).toContain('=== garden__line_mara_you_found_them ===\n-> garden.line_mara_you_found_them');
    // Choosing the entry knot starts at that line: after the Continue break and the exit, with the story's variables.
    const { Story } = await import('inkjs');
    const s = new Story(story.compile.json!);
    s.variablesState['has_flowers'] = true;
    s.ChoosePathString(lines[2].entryKnot);
    expect(s.Continue()).toBe('MARA: You found them!\n');
    expect(s.ContinueMaximally()).toContain('MARA: You found them!');
    expect(s.variablesState['has_flowers']).toBe(false);
    expect(s.currentChoices.map((c) => c.text)).toEqual(['Goodbye']);
    // From the start, the labels change nothing.
    const t = new Story(story.compile.json!);
    expect(t.ContinueMaximally()).toBe('MARA: Do you like flowers?\n');
  });

  it('brings the labelled Ink back unchanged, and has no lines for Ink kept as written', async () => {
    const { lineEntries } = await import('../src/core/lines');
    const { project } = await build(src, 'g.md', 'structured');
    const ink = generateInk(project).ink;
    const back = (await build(ink, 'g.ink', 'structured')).project;
    expect(back.passages.map((p) => p.id)).toEqual(['garden']);
    expect(back.passages[0].content.filter((b) => b.type === 'dialogue')).toHaveLength(4);
    const strip = (x: string) => x.replace(/ \(source line \d+\)/g, '');
    expect(strip(generateInk(back).ink)).toBe(strip(ink));
    const kept = await buildStory([{ fileName: 's.ink', text: '-> a\n=== a ===\nMIRA: Hi {name}.\n-> END\n', inkMode: 'keep' }], { mode: 'structured' });
    expect(lineEntries(kept.project)).toEqual([]);
  });

  it('gives Unity and Unreal the lines and an Enter Dialogue Trigger', async () => {
    const { project } = await build(src, 'g.md', 'structured');
    const story = processProject(project);
    const unity = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'Garden', engineVersion: '6000.0', integrationRef: 'v1.2.3', includeDemo: false });
    const u = (end: string) => String(unity.files.find((f) => f.path.endsWith(end))!.content);
    expect(u('StoryInfo.cs')).toContain('public static readonly string[] Passages = { "garden" };');
    expect(u('StoryInfo.cs')).toContain('"garden.line_mara_you_found_them_2"');
    expect(u('StoryInfo.cs')).toContain('"MARA: You found them!"');
    expect(u('NarrativeController.cs')).toContain('public void EnterAt(string name)');
    expect(u('NarrativeEnterDialogueTrigger.cs')).toContain('[StoryLine("passage")');
    expect(u('StoryPointDrawers.cs')).toContain('[CustomPropertyDrawer(typeof(StoryLineAttribute))]');
    const unreal = await ADAPTERS.unreal.export(story, { engine: 'unreal', projectName: 'Garden', engineVersion: '5.7', integrationRef: 'v1.2.3', includeDemo: false });
    const r = (end: string) => String(unreal.files.find((f) => f.path.endsWith(end))!.content);
    expect(r('NarrativeBridgeStoryInfo.h')).toContain('static const TCHAR* Passages[] = { TEXT("garden") };');
    expect(r('NarrativeBridgeStoryInfo.h')).toContain('static const int32 NumLines = 4;');
    expect(r('NarrativeEnterDialogueTrigger.h')).toContain('meta = (GetOptions = "GetLineOptions")');
    expect(r('NarrativeBridgeComponent.cpp')).toContain('InkStory->ChoosePath(InkPathOf(Name));');
  });
});

describe('cutscenes', () => {
  const script = `INT. LIGHTHOUSE - NIGHT

@cutscene

Rain lashes the glass.

MARA
(whispering)
Did you hear that?

@pause

TOM
Only the wind.

EXT. CLIFF - DAY

Waves break below.

MARA
Look.
`;

  it('plays only a cutscene’s dialogue, tagged #cutscene, with nothing to click in between', async () => {
    const { Story } = await import('inkjs');
    const { project } = await build(script);
    const [cut, after] = project.passages;
    expect(cut.cutscene).toBe(true);
    expect(after.cutscene).toBeUndefined();
    const s = processProject(project);
    expect(s.compile.ok).toBe(true);
    expect(s.generated.ink).toContain('MARA: Did you hear that? #speaker:mara #cutscene');
    expect(s.generated.ink).toContain('// Players don’t see this: Rain lashes the glass.');
    const st = new Story(s.compile.json!);
    const text = st.ContinueMaximally();
    // No Continue break inside the cutscene, the scene after it as written.
    expect(text).not.toContain('Rain lashes');
    expect(text).not.toContain('whispering');
    expect(text).toContain('MARA: Did you hear that?\nTOM: Only the wind.\nWaves break below.');
    expect(st.currentTags).not.toContain('cutscene'); // "Look." is after the cutscene
  });

  it('comes back from Ink, and carries into Twine, the playable page and Unity', async () => {
    const { buildTwee, buildPlayableHtml } = await import('../src/core/export');
    const { project } = await build(script);
    const s = processProject(project);
    const back = (await build(s.generated.ink, 'story.ink', 'structured')).project;
    expect(back.passages.map((p) => !!p.cutscene)).toEqual([true, false]);
    const twee = buildTwee(s, 'sugarcube');
    expect(twee).toMatch(/Did you hear that\?\n<<timed \d\.\ds t8n>>\n@@\.speaker;TOM@@\nOnly the wind\.\n<<next \d\.\ds>>\n\[\[Continue->/);
    expect(twee.match(/<<timed/g)).toHaveLength(1);
    expect(buildPlayableHtml(s, '/* runtime */')).toContain("cut: tags.indexOf('cutscene') >= 0");
    const unity = await ADAPTERS.unity.export(s, { engine: 'unity', projectName: 'P', engineVersion: '6000.3', integrationRef: 'v1.21.0', includeDemo: true });
    const all = unity.files.map((f) => f.content).join('\n');
    expect(all).toContain('else if (t == "cutscene") cutscene = true;');
    expect(all).toContain('CutsceneSeconds(visible)');
    const unreal = await ADAPTERS.unreal.export(s, { engine: 'unreal', projectName: 'P', engineVersion: '5.7', integrationRef: 'v1.21.0', includeDemo: true });
    const cpp = unreal.files.map((f) => f.content).join('\n');
    expect(cpp).toContain('else if (Name == TEXT("cutscene")) Line.bIsCutscene = true;');
    expect(cpp).toContain('if (Next.bIsCutscene)');
    expect(cpp).toMatch(/ReservedTags[^;]*"cutscene"/);
  });
});
