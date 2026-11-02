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

describe('Ink passthrough', () => {
  it('keeps existing Ink verbatim and analyses its graph', async () => {
    const ink = `VAR has_k = false\n-> hall\n=== hall ===\nA hall.\n* {has_k} [Open] -> room\n* [Search]\n  ~ has_k = true\n  -> hall\n=== room ===\nDone.\n-> END\n`;
    const { project, diagnostics } = await build(ink, 'story.ink');
    const r = processProject(project, diagnostics);
    expect(r.generated.ink).toBe(ink);
    expect(r.compile.ok).toBe(true);
    expect(r.analysis.graph.edges.map((e) => `${e.from}->${e.to}`)).toEqual(expect.arrayContaining(['hall->room', 'hall->hall']));
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
      const manifest = JSON.parse(res.files.find((f) => f.path.endsWith('narrative-bridge.manifest.json'))!.content);
      expect(manifest.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(manifest.validation.engineSmokeTest).toBe('pending');
    });
  }
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
    expect(html.match(/<script/g)!.length).toBe(4);
  });

  it('Twine export maps conditions, setters, endings and stable IFIDs', async () => {
    const { buildTwee } = await import('../src/core/export');
    const { ifidFor } = await import('../src/core/export/twine');
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const twee = buildTwee(processProject(project));
    expect(twee).toContain('"start": "Archive Entrance"');
    expect(twee).toContain('<<set $has_archive_key to false>>');
    expect(twee).toContain('<<if ($has_archive_key)>>[[Open the archive|The Vault][$has_archive_key to false]]<</if>>');
    expect(twee).toContain(':: The Vault [ending]');
    expect(ifidFor('x')).toBe(ifidFor('x'));
    expect(ifidFor('x')).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  });

  it('Twine export refuses Ink passthrough projects', async () => {
    const { buildTwee, ExportBlockedError } = await import('../src/core/export');
    const { project, diagnostics } = await build('-> a\n=== a ===\nHi\n-> END\n', 'a.ink');
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
    const { readFileSync } = await import('node:fs');
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
