import { describe, expect, it } from 'vitest';
import { reviewAll } from '../src/core/adapt';
import { buildStory } from '../src/core/builder';
import { ADAPTERS, type ExportResult } from '../src/core/export';
import { type StoryProject } from '../src/core/isr';
import { processProject } from '../src/core/pipeline';
import { SAMPLES } from '../src/samples';
import { build } from './helpers';

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
