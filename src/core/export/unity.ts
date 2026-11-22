import { log } from '../log';
import type { ProcessedStory } from '../pipeline';
import { portraitFiles } from '../images';
import { itemVar, type Condition } from '../isr';
import { assertExportable, audioFiles, buildManifest, imageFiles, commonFiles, json, sourceFiles, storyVersion, verifyExport } from './common';
import type { EngineAdapter, ExportFile, ExportOptions, ExportResult } from './types';
import { storyRoutes, type StoryRoute } from './routes';
import { cueSounds } from '../cues';
import { audioFileName } from '../audio';
import { translationSheet } from './translations';
import { normaliseUnityTheme, unityThemeJson } from './unityTheme';
import { SETTINGS_CS, THEME_CS, VIEW_CS } from './unityUi';
import { ADDRESSABLES_SETUP_CS, CONTROLLER_CS, CUE_PLAYER_CS, DEBUGGER_CS, EDITOR_CS, GATED_CHOICE_CS, INVENTORY_CS, LOCALIZATION_CS, LOCALIZATION_TABLES_CS, PLAY_TESTS_CS, ROUTES_RUNNER_CS, ROUTE_TESTS_CS, SAVE_STORAGE_CS, TMP_SETUP_CS } from './templates.generated';
import {
  editorAsmdef,
  ENTER_DIALOGUE_TRIGGER_CS,
  STORY_POINT_DRAWERS_CS,
  fillTemplate,
  FIRST_OPEN_CS,
  INK_PACKAGE,
  packageJson,
  runtimeAsmdef,
  SAMPLE_INVENTORY_CS,
  SAMPLE_LISTENER_CS,
  SAMPLE_EXITS_CS,
  SAMPLE_TRIGGER_CS,
  samplesAsmdef,
  SEMVER,
  SETUP_CS,
  setupAsmdef,
  testsAsmdef,
  playTestsAsmdef,
  unityPackageId,
  withMetas,
  type UnityPackageId,
} from './unityPackage';

// Unity adapter. The export is a Unity package (UPM) that adds the story to an existing game: its own
// assemblies and namespace, the story precompiled (from the pinned preflight compiler) in its Resources,
// the canonical .ink, the story UI, and editor tools. It runs on inkle's Ink Unity Integration
// (com.inkle.ink-unity-integration), which the package installs when the game doesn't have it. The
// "complete project" layout wraps the same package in a new Unity project with a demo scene.

export const unityAdapter: EngineAdapter = {
  id: 'unity',
  label: 'Unity',
  // Unity 6.3 LTS, the newest Unity, for a complete new project. Packages still support 2022.3 and later.
  defaultEngineVersion: '6000.3.23f1',
  integration: {
    name: 'Ink Unity Integration',
    repository: 'https://github.com/inkle/ink-unity-integration.git',
    defaultRef: '2.0.0',
  },
  requirements: (o) => [
    o.unityLayout === 'project'
      ? { id: 'unity', label: `Unity ${o.engineVersion} (Unity 6 recommended; 2022.3 LTS or later)`, detail: 'Install through Unity Hub.', probe: { paths: ['/Applications/Unity/Hub/Editor', 'C:\\Program Files\\Unity\\Hub\\Editor', '~/Unity/Hub/Editor'] } }
      : { id: 'unity', label: 'Your Unity project (2022.3 LTS or later)', detail: 'The package adds the story to a game you already have; nothing in your project is replaced.', probe: { paths: ['/Applications/Unity/Hub/Editor', 'C:\\Program Files\\Unity\\Hub\\Editor', '~/Unity/Hub/Editor'] } },
    { id: 'git', label: 'Git on PATH', detail: 'Unity Package Manager needs git to fetch Ink Unity Integration from GitHub (skip if your game already has it).', probe: { command: 'git --version' } },
  ],
  async export(story, options) {
    assertExportable(story);
    const layout = options.unityLayout ?? 'package';
    const id = unityPackageId(options.projectName, story.project.project.title);
    const version = options.packageVersion && SEMVER.test(options.packageVersion) ? options.packageVersion : '1.0.0';
    const projectRoot = `${options.projectName}/`;
    const pkg = layout === 'package' ? `${id.name}/` : `${projectRoot}Packages/${id.name}/`;
    const res = `${pkg}Runtime/Resources/NarrativeBridge/${id.slug}/`;
    const manifest = await buildManifest(story, options, this);
    // Voice clips and pictures sit in Resources, or (Addressables) in Runtime/StoryAssets, which isn't built into the
    // game by itself: the package's editor code puts them in an Addressables group.
    const media = options.unityAddressables ? `${pkg}Runtime/StoryAssets/` : res;
    const voice = audioFiles(story, options.audio, `${media}Audio/`);
    // Scene pictures ship as their PNG/JPEG bytes (Images/<file>.bytes) and are decoded at run time: no
    // texture import settings to depend on, the same in every Unity version, and kept at full size.
    const pictures = imageFiles(story, options.images, `${media}Images/`, '.bytes');
    const cs = (template: string) => fillTemplate(template, id, { __INK_URL__: unityPackageUrl(options.integrationRef), __ASSET_FOLDER__: `Assets/NarrativeBridge/${id.namespace.split('.').pop()}`, __USES_ADDRESSABLES__: options.unityAddressables ? 'true' : 'false' });
    const sample = `${pkg}Samples~/Hooking into your game/`;
    // Playthrough routes for the package's tests; not for Ink with randomness, which needn't replay the same way.
    const routes = /RANDOM\(|\{~/.test(story.generated.ink) ? [] : storyRoutes(story.compile.json!, story.project);
    const packageFiles: ExportFile[] = [
      { path: `${pkg}package.json`, content: json(packageJson(id, { version, title: story.project.project.title, description: packageDescription(story), unity: '2022.3' })) },
      { path: `${pkg}README.md`, content: packageReadme(story, options, id) },
      { path: `${pkg}CHANGELOG.md`, content: `# Changelog\n\n## ${version}\n\nExported from Narrative Bridge (story version \`${storyVersion(story)}\`).\n` },
      // The canonical, validated Ink. Folders ending in ~ aren't imported by Unity: the smoke test compiles it.
      { path: `${pkg}Ink~/MainStory.ink`, content: story.generated.ink },
      { path: `${pkg}Runtime/${id.namespace}.asmdef`, content: json(runtimeAsmdef(id)) },
      { path: `${pkg}Runtime/StoryInfo.cs`, content: storyInfoCs(story, id, !!options.unityAddressables) },
      { path: `${pkg}Runtime/IInventoryAuthority.cs`, content: cs(INVENTORY_CS) },
      { path: `${pkg}Runtime/GatedChoice.cs`, content: cs(GATED_CHOICE_CS) },
      { path: `${pkg}Runtime/SaveStorage.cs`, content: cs(SAVE_STORAGE_CS) },
      { path: `${pkg}Runtime/NarrativeLocalization.cs`, content: cs(LOCALIZATION_CS) },
      { path: `${pkg}Runtime/NarrativeCuePlayer.cs`, content: cs(CUE_PLAYER_CS) },
      { path: `${pkg}Runtime/NarrativeEnterDialogueTrigger.cs`, content: cs(ENTER_DIALOGUE_TRIGGER_CS) },
      { path: `${pkg}Runtime/NarrativeController.cs`, content: cs(CONTROLLER_CS) },
      { path: `${pkg}Runtime/NarrativeTheme.cs`, content: cs(THEME_CS) },
      { path: `${pkg}Runtime/NarrativeView.cs`, content: cs(VIEW_CS) },
      { path: `${pkg}Runtime/NarrativeSettings.cs`, content: cs(SETTINGS_CS) },
      { path: `${res}MainStory.compiled.json`, content: story.compile.json! },
      // The look chosen on the Export page; NarrativeTheme reads it (see unityTheme.ts).
      { path: `${res}Theme.json`, content: json(unityThemeJson(normaliseUnityTheme(options.unityTheme ?? story.project.presentation?.unity))) },
      // Every piece of text the player sees, keyed, for translators (NarrativeLocalization reads it).
      { path: `${res}Translations.csv`, content: translationSheet(story.project, normaliseUnityTheme(options.unityTheme ?? story.project.presentation?.unity), options.translationLanguages ?? []) },
      ...voice.files,
      ...pictures.files,
      { path: `${pkg}Editor/${id.namespace}.Editor.asmdef`, content: json(editorAsmdef(id)) },
      { path: `${pkg}Editor/NarrativeBridgeEditor.cs`, content: cs(EDITOR_CS) },
      { path: `${pkg}Editor/StoryDebuggerWindow.cs`, content: cs(DEBUGGER_CS) },
      { path: `${pkg}Editor/StoryPointDrawers.cs`, content: cs(STORY_POINT_DRAWERS_CS) },
      { path: `${pkg}Editor/StoryRoutes.cs`, content: storyRoutesCs(routes, id) },
      { path: `${pkg}Editor/PlaythroughRunner.cs`, content: cs(ROUTES_RUNNER_CS) },
      { path: `${pkg}Editor/AddressablesSetup.cs`, content: cs(ADDRESSABLES_SETUP_CS) },
      { path: `${pkg}Editor/TextMeshProSetup.cs`, content: cs(TMP_SETUP_CS) },
      { path: `${pkg}Editor/LocalizationTables.cs`, content: cs(LOCALIZATION_TABLES_CS) },
      { path: `${pkg}Tests/Editor/${id.namespace}.Tests.asmdef`, content: json(testsAsmdef(id)) },
      { path: `${pkg}Tests/Editor/PlaythroughTests.cs`, content: cs(ROUTE_TESTS_CS) },
      { path: `${pkg}Tests/Runtime/${id.namespace}.PlayTests.asmdef`, content: json(playTestsAsmdef(id)) },
      { path: `${pkg}Tests/Runtime/StoryPlayModeTests.cs`, content: cs(PLAY_TESTS_CS) },
      { path: `${pkg}Editor/Setup/${id.namespace}.Setup.asmdef`, content: json(setupAsmdef(id)) },
      { path: `${pkg}Editor/Setup/InkSetup.cs`, content: cs(SETUP_CS) },
      { path: `${sample}${id.namespace}.Samples.asmdef`, content: json(samplesAsmdef(id)) },
      { path: `${sample}StoryTrigger.cs`, content: cs(SAMPLE_TRIGGER_CS) },
      { path: `${sample}StoryInventoryBridge.cs`, content: cs(SAMPLE_INVENTORY_CS) },
      { path: `${sample}StoryEventsListener.cs`, content: cs(SAMPLE_LISTENER_CS) },
      { path: `${sample}StoryExits.cs`, content: cs(SAMPLE_EXITS_CS) },
      ...commonFiles(story, manifest, `${pkg}NarrativeBridge~/`),
      ...sourceFiles(story, `${pkg}NarrativeBridge~/`, options.originals),
    ];
    const files = await withMetas(packageFiles, pkg, id.name);
    if (layout === 'project') {
      files.push(
        { path: `${projectRoot}Packages/manifest.json`, content: json(projectManifest(options, id.name)) },
        { path: `${projectRoot}ProjectSettings/ProjectVersion.txt`, content: `m_EditorVersion: ${options.engineVersion}\n` },
        { path: `${projectRoot}README.md`, content: projectReadme(story, options, id) },
        ...(options.includeDemo ? [{ path: `${projectRoot}Assets/Editor/OpenDemoOnFirstOpen.cs`, content: cs(FIRST_OPEN_CS) }] : []),
      );
    }
    const rootName = layout === 'package' ? id.name : options.projectName;
    const result: ExportResult = {
      engine: 'unity',
      rootName,
      files,
      manifest,
      unityPackage: { name: id.name, version, root: pkg, namespace: id.namespace },
      report: {
        exportPath: `${rootName}/`,
        engine: 'Unity',
        engineVersion: options.engineVersion,
        integration: `${this.integration.name} @ ${options.integrationRef}`,
        filesCreated: files.map((f) => f.path),
        warnings: [],
        errors: [],
        setupInstructions: setupSteps(options, id),
        diagnostics: [],
      },
    };
    for (const name of voice.missing) result.report.warnings.push(`Voice clip "${name}" is missing from this browser, so it was left out of the package.`);
    for (const name of pictures.missing) result.report.warnings.push(`Scene picture "${name}" is missing from this browser, so it was left out of the package.`);
    finalize(result, story, [`${pkg}package.json`, `${pkg}Ink~/MainStory.ink`, `${res}MainStory.compiled.json`, ...(layout === 'project' ? [`${projectRoot}Packages/manifest.json`] : [])], `${pkg}NarrativeBridge~/`);
    return result;
  },
};

export function finalize(result: ExportResult, story: ProcessedStory, required: string[], reportDir = `${result.rootName}/NarrativeBridge/`) {
  const ds = verifyExport(result, story, required);
  result.report.diagnostics = ds;
  result.report.errors = ds.filter((d) => d.severity === 'error').map((d) => d.message);
  result.report.warnings = [
    ...result.report.warnings,
    ...ds.filter((d) => d.severity === 'warning').map((d) => d.message),
    ...story.diagnostics.filter((d) => d.severity === 'warning' || d.severity === 'review').map((d) => d.message),
  ];
  result.manifest.validation.exportVerification = result.report.errors.length ? 'failed' : 'passed';
  const manifestPath = result.files.find((f) => f.path.endsWith('narrative-bridge.manifest.json'));
  if (manifestPath) manifestPath.content = json(result.manifest);
  result.files.push({ path: `${reportDir}export-report.json`, content: json(result.report) });
  log('export').info(`Built ${result.report.engine} package`, {
    files: result.files.length,
    bytes: result.files.reduce((n, f) => n + (typeof f.content === 'string' ? f.content.length : f.content.byteLength), 0),
    voiceClips: result.files.filter((f) => /\.(wav|mp3|ogg)$/.test(f.path)).length,
    warnings: result.report.warnings.length,
    errors: result.report.errors.length,
    integration: result.report.integration,
  });
}

/** UPM git URL. Releases 2.x keep the package in a subfolder; the legacy "upm" branches have it at the root. */
export function unityPackageUrl(ref: string): string {
  const path = ref.startsWith('upm') ? '' : `?path=/Packages/${INK_PACKAGE}`;
  return `${unityAdapter.integration.repository}${path}#${ref}`;
}

function projectManifest(o: ExportOptions, id: string) {
  return {
    // The story's package sits in Packages/ (an embedded package), so it needs no entry here.
    dependencies: {
      [INK_PACKAGE]: unityPackageUrl(o.integrationRef),
      'com.unity.modules.audio': '1.0.0',
      'com.unity.modules.imageconversion': '1.0.0',
      'com.unity.modules.imgui': '1.0.0',
      'com.unity.modules.jsonserialize': '1.0.0',
      // uGUI for the story panel (NarrativeView). 2022.3 ships 1.0.0; Unity 6 raises it to its own 2.0.0.
      'com.unity.ugui': '1.0.0',
      // The Test Runner, for the story's playthrough tests.
      'com.unity.test-framework': '1.4.6',
      // Voice clips and pictures loaded on demand (2.x is for Unity 6; 1.x for 2022.3).
      ...(o.unityAddressables ? { 'com.unity.addressables': /^6\d{3}\./.test(o.engineVersion) ? '2.11.2' : '1.29.0' } : {}),
    },
    // Shows the story package's tests in the Test Runner.
    testables: [id],
  };
}

/** package.json's "unity": the oldest editor the package supports (never below 2022.3, which the code needs). */
export function minimumUnity(engineVersion: string): string {
  const m = /^(\d{4})\.(\d+)/.exec(engineVersion.trim());
  if (!m) return '2022.3';
  const [year, minor] = [+m[1], +m[2]];
  return year > 2022 || (year === 2022 && minor >= 3) ? `${year}.${minor}` : '2022.3';
}

function packageDescription(story: ProcessedStory): string {
  const p = story.project;
  const n = p.passages.length;
  return `The interactive story "${p.project.title}" (${n} passage${n === 1 ? '' : 's'}), with a themed story panel, voice clips, scene pictures, save/load and inventory hooks. Exported from Narrative Bridge; runs on Ink Unity Integration.`;
}

function setupSteps(o: ExportOptions, id: UnityPackageId): string[] {
  const smoke = `Optional: check it with Tools → Narrative Bridge → ${id.menuTitle} → Run Story Smoke Test, or headless: Unity -batchmode -projectPath <path> -executeMethod ${id.namespace}.EditorTools.NarrativeBridgeEditor.RunSmokeTestBatch`;
  if (o.unityLayout === 'project')
    return [
      `Open Unity Hub → Add → select the "${o.projectName}" folder. Open it with Unity ${o.engineVersion} or any later 2022.3+/6000.x editor.`,
      'Unity Package Manager fetches Ink Unity Integration from GitHub on first open (git must be installed).',
      'The story panel’s text is TextMeshPro: its essentials are imported by themselves on first open (Assets/TextMesh Pro). If the panel is ever empty on Play, stop, choose Window → TextMeshPro → Import TMP Essential Resources, and press Play again.',
      o.includeDemo
        ? `The "NarrativeDemo" scene is created automatically on first open (Assets/NarrativeBridge/). Press Play to run the story. Change its look in the NarrativeTheme asset next to it (even while playing).`
        : `Add the story to a scene with GameObject → Narrative Bridge → ${id.menuTitle}, then press Play.`,
      `The story itself is the package in Packages/${id.name}; copy that folder into any other Unity project to use it there.`,
      smoke,
    ];
  return [
    `Unzip the download into your game's Packages folder (you should see Packages/${id.name}/package.json). Unity picks it up by itself. Or: Window → Package Manager → + → Install package from disk… and choose package.json, or Install package from tarball… with the .tgz download.`,
    `If your game doesn't have Ink Unity Integration yet, the package offers to install it (from GitHub; git must be installed). Until then its scripts stay switched off, so your project keeps compiling.`,
    `If your game has never used TextMeshPro, its essentials are imported when the package arrives (Assets/TextMesh Pro); without them the story panel shows no text.`,
    `Add the story to a scene: GameObject → Narrative Bridge → ${id.menuTitle} (the controller with the story panel), or Tools → Narrative Bridge → ${id.menuTitle} → Create Demo Scene to try it on its own.`,
    `Connect it to your game: use NarrativeController's events (LineShown, ChoicesShown, StoryEnded, TagFound, VariableChanged) or its Inspector events, give it your inventory (IInventoryAuthority), and start it where you like with StartAt("passage"). Package Manager → ${id.menuTitle} → Samples has examples. Code is in the ${id.namespace} namespace.`,
    smoke,
  ];
}

function csString(s: string): string {
  return JSON.stringify(s);
}

function storyRoutesCs(routes: StoryRoute[], id: UnityPackageId): string {
  const route = (r: StoryRoute) =>
    `            new Route(${csString(r.name)}, new string[] { ${r.choices.map(csString).join(', ')} }, ${r.ending ? csString(r.ending) : 'null'}, ${csString(r.lastLine)}),`;
  return `// <auto-generated> by Narrative Bridge. Regenerated on every export. </auto-generated>
namespace ${id.namespace}.EditorTools
{
    /// <summary>
    /// Playthrough routes found when the story was exported: between them they reach every ending the automated
    /// playthroughs reached. PlaythroughRunner (and the package's tests) replay them to check the story still plays
    /// as written.
    /// </summary>
    public static class StoryRoutes
    {
        public sealed class Route
        {
            public readonly string Name;
            /// <summary>The text of each choice to take (Continue breaks and exits to the game included).</summary>
            public readonly string[] Choices;
            /// <summary>The passage it ends in, or null.</summary>
            public readonly string Ending;
            /// <summary>The last line read, as ink prints it ("MIRA: Hello." for dialogue).</summary>
            public readonly string LastLine;

            public Route(string name, string[] choices, string ending, string lastLine)
            {
                Name = name;
                Choices = choices;
                Ending = ending;
                LastLine = lastLine;
            }
        }

        public static readonly Route[] All =
        {
${routes.map(route).join('\n')}
        };
    }
}
`;
}

/** A choice's condition as C#, reading Ink variables through r (see GatedChoice). */
export function conditionCs(c: Condition): string {
  switch (c.type) {
    case 'has_item':
      return `GatedChoice.Has(r(${csString(itemVar(c.itemId))}))`;
    case 'not':
      return `!(${conditionCs(c.condition)})`;
    case 'and':
      return `(${c.conditions.map(conditionCs).join(' && ') || 'true'})`;
    case 'or':
      return `(${c.conditions.map(conditionCs).join(' || ') || 'false'})`;
    case 'compare': {
      const v = c.value;
      const lit = typeof v === 'string' ? csString(v) : typeof v === 'boolean' ? String(v) : Number.isInteger(v) ? String(v) : `${v}d`;
      return `GatedChoice.Compare(r(${csString(c.variableId)}), ${csString(c.op)}, ${lit})`;
    }
  }
}

function storyInfoCs(story: ProcessedStory, id: UnityPackageId, addressables = false): string {
  // What the story is made of comes from the pass that wrote the Ink (generateInk's ReaderInfo), not from the model again.
  const { passages: passageInfo, acts, lines, itemVariables: items, variables: vars, exits, cues, cueTags } = story.generated.info;
  const passages = passageInfo.map((p) => p.id);
  const portraits = Object.entries(portraitFiles(story.project));
  const soundTags = [...cueSounds(story.project)].map(([t, ref]) => [t, audioFileName(ref)] as const);
  const passageActs = passageInfo.map((p) => p.act);
  const knots = new Set(passages);
  const gatedInfo = story.generated.info.gated.filter((g) => knots.has(g.passage));
  const gated = gatedInfo.map((g) => `new GatedChoice(${csString(g.passage)}, ${csString(g.text)}, ${g.requirements.map((r) => `new GatedChoice.Requirement(${csString(r.words)}, r => ${conditionCs(r.condition)})`).join(', ')})`);
  return `// <auto-generated> by Narrative Bridge. Regenerated on every export. </auto-generated>
namespace ${id.namespace}
{
    public static class StoryInfo
    {
        public const string Title = ${csString(story.project.project.title)};
        public const string ProjectId = ${csString(story.project.project.id)};
        /// <summary>Changes whenever the generated Ink changes. Save data from another version is carried over or rejected.</summary>
        public const string StoryVersion = ${csString(storyVersion(story))};
        public const string PackageName = ${csString(id.name)};

        /// <summary>Where the story's files are, inside the package's Resources (for Resources.Load).</summary>
        public const string ResourceFolder = ${csString(`NarrativeBridge/${id.slug}/`)};
        public const string CompiledResource = ResourceFolder + "MainStory.compiled";
        public const string ThemeResource = ResourceFolder + "Theme";
        public const string AudioFolder = ResourceFolder + "Audio/";
        public const string ImageFolder = ResourceFolder + "Images/";
        /// <summary>The translation sheet (a CSV; see NarrativeLocalization).</summary>
        public const string TranslationsResource = ResourceFolder + "Translations";
        /// <summary>The language the story is written in (the sheet's "source" column).</summary>
        public const string SourceLanguage = "en";
        /// <summary>The String Table Collection Create Localization Tables makes (Unity's Localization package).</summary>
        public const string StringTableName = ${csString(`${id.slug}-story`)};
        /// <summary>Voice clips and pictures load on demand with Addressables (see AddressPrefix), not from Resources.</summary>
        public static readonly bool UsesAddressables = ${addressables};
        /// <summary>Their Addressables addresses: AddressPrefix + "Audio/&lt;clip&gt;" and AddressPrefix + "Images/&lt;file&gt;".</summary>
        public const string AddressPrefix = ${csString(`NarrativeBridge/${id.slug}/`)};
        /// <summary>Where those files are in the package (with Addressables).</summary>
        public const string StoryAssetsFolder = ${csString(`Packages/${id.name}/Runtime/StoryAssets/`)};

        /// <summary>Every passage (ink knot) the story can start at: NarrativeController.StartAt(name).</summary>
        public static readonly string[] Passages = { ${passages.map(csString).join(', ')} };
        /// <summary>Each passage's title, in the same order as Passages (for save slots and menus).</summary>
        public static readonly string[] PassageTitles = { ${passageInfo.map((p) => csString(p.title)).join(', ')} };
        /// <summary>The story's acts (groups of passages), in order; empty when it has none.</summary>
        public static readonly string[] Acts = { ${acts.map((a) => csString(a.id)).join(', ')} };
        /// <summary>Each act's title, in the same order as Acts (for chapter menus and save slots).</summary>
        public static readonly string[] ActTitles = { ${acts.map((a) => csString(a.title)).join(', ')} };
        /// <summary>The act each passage is in, in the same order as Passages ("" for a passage in no act).</summary>
        public static readonly string[] PassageActs = { ${passageActs.map(csString).join(', ')} };
        /// <summary>The act a passage is in (NarrativeController.CurrentPassage, say), or "" when it's in none.</summary>
        public static string ActOf(string passage)
        {
            var i = System.Array.IndexOf(Passages, passage);
            return i < 0 ? "" : PassageActs[i];
        }
        /// <summary>An act's title, or "" for an unknown act.</summary>
        public static string ActTitle(string act)
        {
            var i = System.Array.IndexOf(Acts, act);
            return i < 0 ? "" : ActTitles[i];
        }
        /// <summary>
        /// Every line of dialogue the story can start at, as "passage.line_…": StartAt(name) or ResumeAt(name) picks a
        /// conversation up there instead of at the top of its passage (StoryTrigger's Line does it without code).
        /// </summary>
        public static readonly string[] Lines = { ${lines.map((l) => csString(l.path)).join(', ')} };
        /// <summary>Each line as it reads, "MARA: Did you bring the flowers?", in the same order as Lines (for menus).</summary>
        public static readonly string[] LineTexts = { ${lines.map((l) => csString(l.display)).join(', ')} };
        /// <summary>Ink variables that mirror inventory items (has_&lt;item&gt;).</summary>
        public static readonly string[] ItemVariables = { ${items.map(csString).join(', ')} };
        /// <summary>Story variables the game is allowed to read and write.</summary>
        public static readonly string[] Variables = { ${vars.map(csString).join(', ')} };
        /// <summary>Characters with a portrait (speaker ids, as in #speaker tags), and each one's picture in ImageFolder.</summary>
        /// <summary>The story's exits to the game (NarrativeController.ExitReached gives their names).</summary>
        public static readonly string[] Exits = { ${exits.map(csString).join(', ')} };
        public static readonly string[] PortraitSpeakers = { ${portraits.map(([k]) => csString(k)).join(', ')} };
        public static readonly string[] PortraitFiles = { ${portraits.map(([, f]) => csString(f)).join(', ')} };
        /// <summary>The cues the writer added (#music:calm → "music"); NarrativeCuePlayer plays them.</summary>
        public static readonly string[] Cues = { ${cues.map(csString).join(', ')} };
        /// <summary>Every cue as it appears in the story, with its value (e.g. "music:calm"), to know which clips to add.</summary>
        public static readonly string[] CueTags = { ${cueTags.map(csString).join(', ')} };
        /// <summary>Cues the writer attached a sound to (e.g. "music:calm"), and each one's clip (an #audio-style file name; see NarrativeController.LoadVoiceClip).</summary>
        public static readonly string[] CueSoundTags = { ${soundTags.map(([t]) => csString(t)).join(', ')} };
        public static readonly string[] CueSoundFiles = { ${soundTags.map(([, f]) => csString(f)).join(', ')} };
        /// <summary>Forced choices, as "passage\\ntext": while one is on offer it's the only choice, so nothing is shown as locked.</summary>
        public static readonly string[] ForcedChoices = { ${gatedInfo.filter((g) => g.forced).map((g) => csString(`${g.passage}\n${g.text}`)).join(', ')} };
        /// <summary>Choices that need an item or a value (NarrativeController.LockedChoices lists the ones locked right now).</summary>
        public static readonly GatedChoice[] GatedChoices =
        {
${gated.map((g) => `            ${g},`).join('\n')}
        };
    }
}
`;
}

function packageReadme(story: ProcessedStory, o: ExportOptions, id: UnityPackageId): string {
  return `# ${story.project.project.title}: a Narrative Bridge story for Unity

Package \`${id.name}\`, story version \`${storyVersion(story)}\`, generated by Narrative Bridge. Everything is in the
\`${id.namespace}\` namespace and its own assemblies, so it sits beside your game's code (and other Narrative Bridge
stories) without clashing, and it never changes your scenes, build settings or project settings on its own.

## Install
1. **Unzip into your game's \`Packages\` folder**, so you have \`Packages/${id.name}/package.json\`. Unity picks it up by itself.
   Or in Unity: *Window → Package Manager → + → Install package from disk…* and choose \`package.json\`, or
   *Install package from tarball…* with the \`.tgz\`. (Keep the file inside your project, for example in \`Packages/\`.)
2. **Ink Unity Integration.** The story runs on inkle's free ink runtime. If your game doesn't have it, the package
   asks to install it (from GitHub; git must be installed), or use *Tools → Narrative Bridge → ${id.menuTitle} → Install
   Ink Unity Integration*. Until it's there the story's scripts stay switched off, so your project still compiles.
   You can also add it yourself in \`Packages/manifest.json\`:
   \`"${INK_PACKAGE}": "${unityPackageUrl(o.integrationRef)}"\`.
   If your game already has ink some other way (for example a copy in Assets), choose *Use the Ink Already in This Project*.

## Add it to a scene
- *GameObject → Narrative Bridge → ${id.menuTitle}* adds a GameObject with the **NarrativeController** (the story) and
  the **NarrativeView** (a themed story panel).
- *Tools → Narrative Bridge → ${id.menuTitle} → Create Demo Scene* makes a scene with just the story, to try it.
- Or add the components yourself (*Add Component → Narrative Bridge → ${id.menuTitle}*).

## Connect it to your game
- **Start it where you want.** Turn off *Start On Awake* and call \`StartStory()\`, or \`StartAt("passage")\` to begin at a
  scene (for a conversation with one character, say). The passages are listed in \`StoryInfo.Passages\`.
- **Pick a conversation up partway.** Every line of dialogue can be a starting point too: \`StartAt("passage.line_…")\`
  (listed in \`StoryInfo.Lines\`, with how each reads in \`StoryInfo.LineTexts\`). \`EnterAt(name)\` does the same but keeps
  what the story knows (its variables and items) when it has already run. Without code, add an **Enter Dialogue
  Trigger** (*Add Component → Narrative Bridge → ${id.menuTitle}*) to an object with a trigger collider, pick the *Passage* and the *Line*
  the player picks up on, and, if you like, the item the player must have: talk about flowers, go and get them, come
  back, and the conversation goes on at "You found them!" instead of from the top.
- **Events, from code:** \`LineShown\` (a \`Line\` with \`Speaker\`, \`Text\`, \`Scene\`, \`Paren\`, \`Image\`, \`Tags\`),
  \`ChoicesShown\` → \`Choose(i)\`, \`ContinueShown\` → \`Continue()\`, \`StoryEnded\`, \`Restarted\`, \`StatusChanged\`,
  \`RuntimeError\`, plus **\`TagFound\`** for tags the story uses that Narrative Bridge doesn't (\`#shake\`, \`#music:calm\`)
  and **\`VariableChanged\`** for every story variable and item.
- **Events, without code:** the same moments as UnityEvents in the controller's Inspector (*On Line*, *On Choices*,
  *On Continue*, *On Ended*, *On Tag*, *On Variable Changed*), to drive animations, sounds or quests.
- **Exits to the game:** where the writer added *Exit to game*, the dialogue stops and raises **\`ExitReached\`** (the exit's
  name, one of \`StoryInfo.Exits\`; *On Exit* in the Inspector). The story panel steps aside while your game plays. When
  the gameplay is done, call **\`Resume()\`** to go on from there, or **\`ResumeAt("passage")\`** to go on somewhere else
  (after a lost fight, say); set variables or items first to tell the story what happened. \`IsAtExit\`/\`CurrentExit\` say
  where it's waiting, saves made at an exit or after a jump load again, and the *StoryExits* sample wires it all up in
  the Inspector without code.
- **Variables:** \`GetVariable(name)\` and \`SetVariable(name, value)\` for the story's own variables (\`StoryInfo.Variables\`).
- **Inventory:** items are Ink Booleans named \`has_<item>\` (\`StoryInfo.ItemVariables\`). Give the controller a component
  implementing \`IInventoryAuthority\` and your inventory becomes the one source of truth: the story asks it before every
  step and sends it the gains and losses instead of keeping its own copy.
- **Locked choices:** a choice that needs an item or a value the player doesn't have is left out by ink. The story panel
  shows it greyed out with what it needs (\`Use the brass key · Needs Brass Key\`; *Show Locked Choices* on the theme), and
  \`LockedChoices\` lists them for your own UI. \`CurrentPassage\` says which passage the reader is in.
- **Choices taken before:** the story panel greys out a choice the player has taken before (in this read or an earlier one;
  still clickable). \`WasChosen(choice)\` says so for your own UI and \`ForgetChosen()\` clears it; it's kept in PlayerPrefs.
- **Forced choices:** while a forced choice's condition holds, ink offers only that choice in its passage (the others carry
  an extra condition), and \`LockedChoices\` stays empty. \`StoryInfo.ForcedChoices\` lists them.
- **Your own UI:** remove the NarrativeView and draw the story from the events above.
- **Voice:** recorded lines play through the controller's AudioSource; set *Voice Source* to route them through your mixer.
- **Portraits:** \`StoryInfo.PortraitSpeakers\` lists the characters with a portrait; \`NarrativeController.LoadPortrait(line.SpeakerId)\`
  gives you one for your own UI.
- **Samples:** *Package Manager → ${id.menuTitle} → Samples → Hooking into your game* has a trigger that starts the story
  and pauses your game, an inventory bridge, a listener for tags and variables, and *StoryExits*, which hands the story to your gameplay at each exit.

## Saves
**Save slots.** The story panel's *Save* and *Load* open a menu of slots (*Save Slots* on the controller, 3 by default), each
showing the passage and when it was saved, and an **autosave** is kept each time the reader reaches a new passage (*Autosave*).
From code: \`SaveToSlot(n)\`, \`LoadFromSlot(n)\` (0 is the autosave), \`GetSlots()\` (\`SlotInfo\`: \`Exists\`, \`SavedAt\`,
\`PassageTitle\`, \`Excerpt\`), \`DeleteSlot(n)\` and the \`Saved\` event. Slots are small JSON files in
\`Application.persistentDataPath/NarrativeBridge/${id.name}/\`; to keep them in your game's own saves (Steam Cloud, a console's
save data), give *Save Storage* a component implementing \`ISaveStorage\` (\`Write\`, \`Read\`, \`Delete\`). Set *Save Slots*
to 0 for the single quick save instead.

\`SaveState()\` returns a string you can keep in your own save system (\`SaveToPrefs()\` / \`LoadFromPrefs()\` use one
PlayerPrefs slot), and \`TryLoadState(save, out error)\` restores it. A save from an earlier version of the story is carried
over: the new version is replayed with the same choices, so revising the story doesn't break players' saves.
\`LoadNote\` says what happened.

## The story panel
The NarrativeView draws story text (everything so far, the current scene, or one line at a time), the speaking
character's portrait, the scene picture, choices, the Continue button, the ending and optional Restart / Save / Load.
Its look and behaviour are a **NarrativeTheme** asset with about 70 settings in groups (colours, panel, text, speakers and
scenes, typing and pacing, choices and buttons, toolbar, scene pictures, character portraits, screen and sound): the first time you add the story, one is made in
\`Assets/NarrativeBridge/${id.namespace.split('.').pop()}/\` from the look chosen in Narrative Bridge, and you can change it in the
Inspector, even while playing. The view's *Sorting Order* sets where it draws among your canvases, *Keyboard
Shortcuts* (1-9 choose, Space or Return continue) can be turned off, and it uses your scene's EventSystem when there
is one (it works with the Input Manager and the Input System package). Its text is TextMeshPro whenever your game has it
(built into Unity 6, or the TextMeshPro package on 2022.3): set *TMP Font* on the theme to use your own font asset.
TextMeshPro shows no text until a project has its *TMP Essential Resources*; a project that doesn't gets them imported
when it opens (\`Editor/TextMeshProSetup.cs\`), and *Tools → Narrative Bridge → ${id.menuTitle} → Import TextMeshPro Essentials*
does it by hand. If the panel is ever empty on Play, stop, run that, and press Play again.

## Italics and bold
Lines keep the script's emphasis as \`<i>…</i>\`, \`<b>…</b>\` and \`<u>…</u>\`. NarrativeView shows them (underline needs
TextMeshPro) and types them out letter by letter; any other \`<\` in the story is shown as written. In your own UI, use
\`NarrativeView.Markup(text)\` for rich text or \`NarrativeView.Plain(text)\` for plain text.

## Cues
Writers add cues in Narrative Bridge: music, a sound, an ambience, a camera shake, or a name of their own, with an optional
value (\`#music:calm\`, \`#sound:door_creak\`, \`#shake:0.5\`). They're listed in \`StoryInfo.Cues\` (and with their values in
\`StoryInfo.CueTags\`). The **NarrativeCuePlayer** plays them without code: *Tools → Narrative Bridge → ${id.menuTitle} → Add Cue
Player to Selected Story* lists every cue with a likely action (play or stop music, play a sound, loop an ambience, shake the
camera, or only raise its event). **Sounds the writer attached to cues in Narrative Bridge come with the package and play
by themselves** (\`StoryInfo.CueSoundTags\`; turn off *Play Story Sounds* to use only your own). To use your own sound for a
value, add a clip named after it to the cue (a clip called *calm* for \`music:calm\`): it plays instead of the writer's.
Each cue also has a UnityEvent, \`CuePlayed\` reports every cue from code, and \`TagFound\` still sees them all. A music cue
or ambience cue with no value stops it. (Stories added to a scene after this export get a Cue Player automatically.)

## Story Debugger
*Tools → Narrative Bridge → ${id.menuTitle} → Story Debugger* follows the story while the game plays: the passage the reader
is in, what it's waiting for, the choices (click one to choose it) and the locked ones, every story variable and item (change
them to try a route), a jump to any passage, and saves copied to or loaded from the clipboard.

## Translations
\`Resources/NarrativeBridge/${id.slug}/Translations.csv\` lists every piece of text the player sees (lines, choices, speaker
names, scene headings, stage directions, what locked choices need, and the story panel's own words), one per row, with a key
made from its text. Translators add a column per language (\`fr\`, \`de\`…) and fill it in; put their sheet in its place, or
set the controller's *Translations*. \`NarrativeLocalization.Language\` picks the language (\`""\` for the story as written;
the first time, the player's system language if the sheet has it), and the Settings menu gains a *Language* row. Lines are found
by their text, so revising the story keeps every translation whose line didn't change. \`Line.SourceText\` (and
\`SourceSpeaker\`…) keep the original words.

**Unity's Localization package:** *Tools → Narrative Bridge → ${id.menuTitle} → Create Localization Tables* makes a String Table
Collection, \`${id.slug}-story\`, from the sheet (with a locale per language), and the story then follows the selected locale.
Run it again to bring in a newer sheet.

## Player settings
The panel's *Settings* button opens a menu where the player sets the text size, typing speed (slow, normal, fast or
instant), whether it goes on by itself, high contrast (light text on a solid dark panel) and the voice volume. They're kept
in PlayerPrefs and shared by every Narrative Bridge story in the game. Your own options menu can set the same things
through \`NarrativeSettings\` (\`TextScale\`, \`TypingSpeed\`, \`AutoAdvance\`, \`HighContrast\`, \`VoiceVolume\`, \`Reset()\`); the
menu's words are in the view's *Settings Words*.

## Voice clips and pictures${o.unityAddressables ? ' (Addressables)' : ''}
${o.unityAddressables ? `This story loads its voice clips and pictures **on demand with Addressables**, so they aren't all built into the game.
They're in \`Runtime/StoryAssets/\`, and the package puts them in an Addressables group, *${id.menuTitle} Story*, at the
addresses the controller asks for (\`StoryInfo.AddressPrefix\` + \`Audio/<clip>\` or \`Images/<file>\`). That happens by itself
the first time; after updating the package, run *Tools → Narrative Bridge → ${id.menuTitle} → Set Up Addressables*. The package
offers to install Addressables (\`com.unity.addressables\`) if the project doesn't have it. Build the Addressables content with
your game as usual (*Window → Asset Management → Addressables → Groups → Build*, or on player build). Voice clips and the
story panel's pictures load without waiting (as WebGL needs); \`LoadPicture\` and \`LoadVoiceClip\` wait, and
\`LoadPictureAsync\` / \`LoadVoiceClipAsync\` don't. \`NarrativeController.ReleaseLoadedMedia()\` lets go of what has loaded so far.` : `Voice clips and pictures are in the package's Resources, so they're always built into the game. For long or heavily voiced
stories, export with *Load voice clips and pictures on demand (Addressables)* in Narrative Bridge's advanced settings instead.
From code: \`LoadVoiceClip\`, \`LoadPicture\` (and their \`Async\` versions) and \`ReleaseLoadedMedia()\`.`}

## Updating
Export the story again and replace this folder (or install the new .tgz). Script GUIDs stay the same, so your scenes
keep their references. Your NarrativeTheme asset is never overwritten.

## What's inside
- \`Runtime/\`: the controller, view, theme, \`StoryInfo\`, and the story in \`Resources/NarrativeBridge/${id.slug}/\`
  (the compiled story, its look, voice clips, and scene pictures as their PNG/JPEG bytes).
- \`Editor/\`: menus, the demo scene, the smoke test, the Story Debugger and the playthrough routes; \`Editor/Setup\` installs Ink when needed.
- \`Tests/Editor/\`: the playthrough routes as Test Runner tests; \`Tests/Runtime/\`: Play Mode tests of the story running as in the game.
- \`Ink~/MainStory.ink\`: the story's validated ink source (not imported; the smoke test compiles it).
- \`NarrativeBridge~/\`: the export manifest, validation report, story data and original source documents.

## Playthrough tests
When the story was exported, Narrative Bridge found playthrough routes that between them reach every ending
(\`Editor/StoryRoutes.cs\`). Replay them to check your game still plays the story as written, after you wire it in or
update it: *Tools → Narrative Bridge → ${id.menuTitle} → Run Playthrough Tests*, the Test Runner (*Window → General → Test
Runner → Edit Mode*; add \`"testables": ["${id.name}"]\` to \`Packages/manifest.json\` to list the package's tests, which a
complete-project export already does), or headless:
\`Unity -batchmode -projectPath <your project> -executeMethod ${id.namespace}.EditorTools.PlaythroughRunner.RunBatch\`
(exit code 0 when every route passes). Each failure says which step went differently and what the story offered instead.

## Smoke test
*Tools → Narrative Bridge → ${id.menuTitle} → Run Story Smoke Test*, or headless:
\`Unity -batchmode -projectPath <your project> -executeMethod ${id.namespace}.EditorTools.NarrativeBridgeEditor.RunSmokeTestBatch\`.
It compiles the ink with the ink compiler inside Unity, plays the story 50 times, checks every voice clip and picture
imported, saves and carries a save over, starts at every passage, clicks through the story panel (with its locked choices,
Settings and save-slot menus), plays the cues, and replays the playthrough routes.
`;
}

function projectReadme(story: ProcessedStory, o: ExportOptions, id: UnityPackageId): string {
  return `# ${story.project.project.title}: Unity project

Generated by Narrative Bridge. Story version \`${storyVersion(story)}\`.

## Run it
${setupSteps(o, id).map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Layout
- \`Packages/${id.name}/\`: the story as a Unity package (see its README). The same package can be added to any other
  Unity project.
- \`Packages/manifest.json\`: Ink Unity Integration as \`${unityPackageUrl(o.integrationRef)}\`.
  ${/^[0-9a-f]{7,40}$/i.test(o.integrationRef) || /^v?\d/.test(o.integrationRef) ? 'This ref is pinned.' : '**This ref is a branch.** Replace it with a tested release tag or commit for reproducible builds.'}
${o.includeDemo ? `- \`Assets/Editor/OpenDemoOnFirstOpen.cs\`: makes the demo scene in \`Assets/NarrativeBridge/\` the first time the project opens.\n` : ''}`;
}

