import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reviewAll } from '../src/core/adapt';
import { emphasisHtml, markupToTags, plainText, tagsToFountain } from '../src/core/emphasis';
import { fdxToFountain } from '../src/core/parsing/convert';
import { buildStory } from '../src/core/builder';
import { ADAPTERS } from '../src/core/export';
import { conditionToInk, escapeInk } from '../src/core/inkgen';
import { slugify, uniqueId, type StoryProject } from '../src/core/isr';
import { fountainParser } from '../src/core/parsing/fountain';
import { parseCondition, parseMarker } from '../src/core/parsing/markers';
import { detectFormat } from '../src/core/parsing/registry';
import { processProject } from '../src/core/pipeline';
import { countWords } from '../src/core/stats';
import { compileInk } from '../src/core/validate';
import { SAMPLES } from '../src/samples';
import { build } from './helpers';

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
