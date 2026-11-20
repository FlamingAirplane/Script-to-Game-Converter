import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reviewAll } from '../src/core/adapt';
import { analyze } from '../src/core/analyzer';
import { buildStory } from '../src/core/builder';
import { ADAPTERS } from '../src/core/export';
import { CONTINUE_TEXT, EXIT_PREFIX } from '../src/core/isr';
import { boundaryViolations } from '../src/core/export/unrealBoundary';
import { processProject } from '../src/core/pipeline';
import { SAMPLES } from '../src/samples';
import { build } from './helpers';

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

describe('playable story reading', () => {
  it('parses, scrolls to where a choice led, and takes choices from the keyboard', async () => {
    const { buildPlayableHtml } = await import('../src/core/export');
    const { project } = await build('INT. A - DAY\n\nMIRA\nHello.\n', 'x.fountain');
    const html = buildPlayableHtml(processProject(project), 'window.inkjs={};');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const player = scripts[scripts.length - 1];
    expect(() => new Function(player)).not.toThrow();
    expect(player).toContain("first.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })");
    expect(player).toContain("document.addEventListener('keydown'");
    expect(html).toContain('prefers-reduced-motion:reduce){.text .fresh{animation:none}}');
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
    const data = JSON.parse(r.files.find((f) => f.path.endsWith('StorySource/StoryInfo.json'))!.content as string);
    const locked = data.gatedChoices.find((g: { text: string }) => g.text === 'Open the archive');
    expect(locked).toMatchObject({ passage: 'archive_entry', needs: 'Archive Key', forced: false });
    // Each locked choice's condition is the ISR condition itself, which the runtime's evaluator tests against the story's variables.
    expect(locked.requirements).toEqual([{ words: 'Archive Key', condition: { type: 'has_item', itemId: 'archive_key' } }]);
    expect(data.reservedTags).toContain('speaker');
    const cpp = r.files.find((f) => f.path.endsWith('NarrativeBridgeComponent.cpp'))!.content as string;
    // The words Ink uses for Continue breaks and exits are the same for every story, so they live in the runtime.
    const types = r.files.find((f) => f.path.endsWith('NarrativeBridgeTypes.h'))!.content as string;
    expect(types).toContain(`ExitPrefix = TEXT("${EXIT_PREFIX}");`);
    expect(types).toContain(`ContinueText = TEXT("${CONTINUE_TEXT}");`);
    expect(cpp).toContain('OnCue.Broadcast(Name, Value)');
    expect(cpp).toContain('UNarrativeBridgeComponent::PlainText');
    // Inkpot's SetBool takes a third, out, argument.
    expect(cpp).not.toMatch(/SetBool\([^,)]*,[^,)]*\)/);
    const h = r.files.find((f) => f.path.endsWith('NarrativeBridgeComponent.h'))!.content as string;
    const api = ['void Resume();', 'void ResumeAt(const FString& Passage);', 'void StartAt(const FString& Passage);', 'FNarrativeCue OnCue;', 'FNarrativeWords OnExit;', 'FNarrativeVariable OnVariableChanged;', 'TArray<FNarrativeLockedChoice> GetLockedChoices() const;', 'bool TryLoadState(const FString& Save, FString& Error);', 'static FString RichText(const FString& Text);'];
    for (const fn of api) expect(h).toContain(fn);
    // Braces balance in the generated C++ (a cheap check without an Unreal build).
    for (const src of [cpp, h]) expect(src.split('{').length).toBe(src.split('}').length);
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
    // The panel's look comes only from Theme.json: the C++ defaults are the same for every story.
    expect(file('NarrativeTheme.h')).toContain('bool bShowLockedChoices = true;');
    expect(file('NarrativeTheme.h')).not.toContain('TEXT("night")');
    // Float literals always have a decimal point (1.0f; 1f isn't C++).
    expect(file('NarrativeTheme.h')).not.toMatch(/[^.\d\w]\d+f[;,)]/);
    // Three modules: the project's own, the runtime (the same for every story) and its editor tools, which hold the tests.
    const uproject = JSON.parse(file('Archive.uproject'));
    expect(uproject.Modules.map((m: { Name: string; Type: string }) => m.Name + ':' + m.Type)).toEqual(['Archive:Runtime', 'NarrativeBridge:Runtime', 'NarrativeBridgeEditor:Editor']);
    expect(file('ArchiveEditor.Target.cs')).toContain('ExtraModuleNames.Add("NarrativeBridgeEditor");');
    expect(file('NarrativeBridge.Build.cs')).toContain('"UMG"');
    expect(file('Archive.Build.cs')).toContain('"NarrativeBridge"');
    expect(JSON.parse(file('StorySource/PlaythroughRoutes.json')).routes.length).toBeGreaterThan(0);
    const tests = file('NarrativeBridgeTests.cpp');
    for (const t of ['"NarrativeBridge.Playthrough"', '"NarrativeBridge.StartAtEveryPassage"', '"NarrativeBridge.Saves"', '"NarrativeBridge.TranslationKeys"']) expect(tests).toContain(t);
    const keys = JSON.parse(file('StorySource/TestData.json')).translationKeys;
    expect(keys[0]).toEqual({ text: 'The lamp is out.', key: expect.stringMatching(/^nb_/) });
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

  it('calls Inkpot only from the NarrativeBridgeInk files', async () => {
    const opts = { engine: 'unreal' as const, projectName: 'Archive', engineVersion: '5.7', integrationRef: 'v1.42.21-release', includeDemo: true };
    const r = await ADAPTERS.unreal.export(processProject(await archive()), opts);
    expect(boundaryViolations(r.files)).toEqual([]);
    const names = r.files.map((f) => f.path.split('/').pop());
    for (const n of ['NarrativeBridgeInk.h', 'NarrativeBridgeInk.cpp', 'NarrativeBridgeInkCompat.h', 'NarrativeBridgeInkImport.cpp']) expect(names).toContain(n);
    const h = r.files.find((f) => f.path.endsWith('NarrativeBridgeInk.h'))!.content as string;
    for (const fn of ['Begin(', 'End()', 'CanContinue()', 'Continue()', 'CurrentTags()', 'CurrentChoices()', 'Choose(', 'GoTo(', 'CurrentPath()', 'IsDefined(', 'Get(', 'Set(', 'Observe(', 'ToJson()', 'LoadJson(', 'Reset()']) expect(h).toContain(fn);
    // A file that reaches past the backend is reported.
    expect(boundaryViolations([{ path: 'X/Source/X/Foo.cpp', content: '#include "Inkpot/InkpotStory.h"\n' }])).toHaveLength(1);
    expect(boundaryViolations([{ path: 'X/Source/X/Foo.cpp', content: 'TSharedPtr<Ink::FChoice> C;\n' }])).toHaveLength(1);
    expect(boundaryViolations([{ path: 'X/Source/X/NarrativeBridgeComponent.cpp', content: '// uses Inkpot\n' }])).toHaveLength(1);
  });
});

describe('the Unreal export’s story data', () => {
  it('writes StoryInfo.json that matches its schema and the header, and condition checks the TypeScript evaluator made', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await buildStory([{ fileName: s.fileName, text: s.text }], { mode: s.mode });
    reviewAll(project, 'approved');
    const r = await ADAPTERS.unreal.export(processProject(project), { engine: 'unreal', projectName: 'Archive', engineVersion: '5.7', integrationRef: 'v1.42.21-release', includeDemo: false });
    const file = (end: string) => r.files.find((f) => f.path.endsWith(end))!.content as string;
    const info = JSON.parse(file('StorySource/StoryInfo.json'));
    const schema = JSON.parse(readFileSync('schemas/unreal-story-info.schema.json', 'utf8'));
    // Every field the schema requires is there, and nothing in the data is missing from the schema.
    for (const key of schema.required) expect(info, key).toHaveProperty(key);
    for (const key of Object.keys(info)) expect(schema.properties, key).toHaveProperty(key);
    expect(info.schemaVersion).toBe(1);
    // There is no per-story header any more: the story is data.
    expect(r.files.some((f) => f.path.endsWith('NarrativeBridgeStoryInfo.h'))).toBe(false);
    expect(info.saveFolder).toBe('Archive');
    expect(info.gatedChoices.length).toBeGreaterThan(0);
    // Locked choices carry the ISR condition itself, and ConditionChecks.json has an answer for each one.
    const checks = JSON.parse(file('StorySource/ConditionChecks.json')).checks;
    expect(checks.length).toBe(info.gatedChoices.reduce((n: number, g: { requirements: unknown[] }) => n + g.requirements.length, 0));
    for (const c of checks) {
      expect(c.cases.length).toBeGreaterThan(0);
      expect(c.cases.some((x: { holds: boolean }) => x.holds)).toBe(true);
      expect(c.cases.some((x: { holds: boolean }) => !x.holds)).toBe(true);
    }
    // The runtime and the tests that read it are in the export.
    const names = r.files.map((f) => f.path.split('/').pop());
    for (const n of ['NarrativeBridgeStoryData.h', 'NarrativeBridgeStoryData.cpp', 'NarrativeBridgeCondition.h', 'NarrativeBridgeStoryDataTests.cpp']) expect(names).toContain(n);
  });
});

describe('the Unreal export’s generic runtime', () => {
  it('gives every story the same runtime and editor modules, byte for byte', async () => {
    const out = new Map<string, Map<string, string>>();
    for (const id of ['archive', 'lighthouse']) {
      const sample = SAMPLES.find((x) => x.id === id)!;
      const { project } = await buildStory([{ fileName: sample.fileName, text: sample.text }], { mode: sample.mode });
      reviewAll(project, 'approved');
      const r = await ADAPTERS.unreal.export(processProject(project), { engine: 'unreal', projectName: id === 'archive' ? 'Archive' : 'Lighthouse', engineVersion: '5.7', integrationRef: 'v1.42.21-release', includeDemo: true });
      out.set(id, new Map(r.files.filter((f) => /\/Source\/NarrativeBridge(Editor)?\//.test(f.path)).map((f) => [f.path.replace(/^[^/]+\//, ''), String(f.content)])));
    }
    const [a, b] = [out.get('archive')!, out.get('lighthouse')!];
    expect([...a.keys()].length).toBeGreaterThan(30);
    expect([...b.keys()]).toEqual([...a.keys()]);
    for (const [path, text] of a) expect(b.get(path), path).toBe(text);
    // Nothing in them is the story's: no story or project names, and no reference to the old per-story header.
    for (const [path, text] of a) {
      expect(text, path).not.toContain('NarrativeBridgeStoryInfo');
      expect(text, path).not.toMatch(/ARCHIVE_API|__MODULE__|__API__/);
    }
  });
});
