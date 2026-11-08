import { log } from '../log';
import type { ProcessedStory } from '../pipeline';
import { portraitFiles } from '../images';
import { cueName, cueTag, exitName, isActive, itemVar, type Condition } from '../isr';
import { isForcing } from '../forced';
import { describeCondition } from '../gating';
import { assertExportable, audioFiles, buildManifest, imageFiles, commonFiles, itemVarNames, json, sourceFiles, storyVersion, verifyExport } from './common';
import type { EngineAdapter, ExportFile, ExportOptions, ExportResult } from './types';
import { storyRoutes, type StoryRoute } from './routes';
import { cueSounds } from '../cues';
import { audioFileName } from '../audio';
import { translationSheet } from './translations';
import { normaliseUnityTheme, unityThemeJson } from './unityTheme';
import { SETTINGS_CS, THEME_CS, VIEW_CS } from './unityUi';
import {
  editorAsmdef,
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
      { path: `${pkg}Editor/StoryRoutes.cs`, content: storyRoutesCs(routes, id) },
      { path: `${pkg}Editor/PlaythroughRunner.cs`, content: cs(ROUTES_RUNNER_CS) },
      { path: `${pkg}Editor/AddressablesSetup.cs`, content: cs(ADDRESSABLES_SETUP_CS) },
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
      o.includeDemo
        ? `The "NarrativeDemo" scene is created automatically on first open (Assets/NarrativeBridge/). Press Play to run the story. Change its look in the NarrativeTheme asset next to it (even while playing).`
        : `Add the story to a scene with GameObject → Narrative Bridge → ${id.menuTitle}, then press Play.`,
      `The story itself is the package in Packages/${id.name}; copy that folder into any other Unity project to use it there.`,
      smoke,
    ];
  return [
    `Unzip the download into your game's Packages folder (you should see Packages/${id.name}/package.json). Unity picks it up by itself. Or: Window → Package Manager → + → Install package from disk… and choose package.json, or Install package from tarball… with the .tgz download.`,
    `If your game doesn't have Ink Unity Integration yet, the package offers to install it (from GitHub; git must be installed). Until then its scripts stay switched off, so your project keeps compiling.`,
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
  const items = itemVarNames(story);
  const vars = story.project.variables.map((v) => v.id);
  const passages = [...story.generated.ink.matchAll(/^=== (\w+) ===$/gm)].map((m) => m[1]);
  const portraits = Object.entries(portraitFiles(story.project));
  const exits = [...new Set(story.project.passages.flatMap((p) => p.content.flatMap((b) => (b.type === 'exit' ? [exitName(b.name)] : []))))];
  const cueBlocks = story.project.passages.flatMap((p) => p.content.flatMap((b) => (b.type === 'cue' ? [b] : [])));
  const cues = [...new Set(cueBlocks.map((b) => cueName(b.name)))];
  const cueTags = [...new Set(cueBlocks.map((b) => cueTag(b.name, b.value)))];
  const soundTags = [...cueSounds(story.project)].map(([t, ref]) => [t, audioFileName(ref)] as const);
  const knots = new Set(passages);
  const gated = story.project.passages.flatMap((p) =>
    knots.has(p.id)
      ? p.choices
          .filter((c) => isActive(c.review) && c.conditions.length)
          .map((c) => `new GatedChoice(${csString(p.id)}, ${csString(c.text.trim())}, ${c.conditions.map((x) => `new GatedChoice.Requirement(${csString(describeCondition(x, story.project))}, r => ${conditionCs(x)})`).join(', ')})`)
      : [],
  );
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
        public static readonly string[] PassageTitles = { ${passages.map((k) => csString(story.project.passages.find((p) => p.id === k)?.title || k)).join(', ')} };
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
        public static readonly string[] ForcedChoices = { ${story.project.passages.flatMap((p) => (knots.has(p.id) ? p.choices.filter(isForcing).map((c) => csString(`${p.id}\n${c.text.trim()}`)) : [])).join(', ')} };
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

const INVENTORY_CS = `namespace __NAMESPACE__
{
    /// <summary>
    /// Implement on a MonoBehaviour to make your game the authority for item possession.
    /// The story only requests changes; the game decides and the controller mirrors the result into Ink.
    /// Item ids are StoryInfo.ItemVariables without the "has_" prefix.
    /// </summary>
    public interface IInventoryAuthority
    {
        bool HasItem(string itemId);
        void GiveItem(string itemId);
        void TakeItem(string itemId);
    }
}
`;

const GATED_CHOICE_CS = `using System;
using System.Collections.Generic;

namespace __NAMESPACE__
{
    /// <summary>
    /// A choice that needs an item or a value, as approved in Narrative Bridge (StoryInfo.GatedChoices). Ink hides
    /// such a choice while its condition fails; NarrativeController.LockedChoices lists the ones locked right now,
    /// with what they need in plain words, so the story panel (or your UI) can show them greyed out.
    /// </summary>
    public sealed class GatedChoice
    {
        /// <summary>The passage (ink knot) the choice is in.</summary>
        public readonly string Passage;
        /// <summary>The choice's text, as the story shows it.</summary>
        public readonly string Text;
        readonly Requirement[] requirements;

        public GatedChoice(string passage, string text, params Requirement[] requirements)
        {
            Passage = passage;
            Text = text;
            this.requirements = requirements ?? new Requirement[0];
        }

        /// <summary>What the choice needs that the reader doesn't have, in plain words (empty when it's open).</summary>
        public string[] Missing(Func<string, object> read)
        {
            var list = new List<string>();
            foreach (var r in requirements) if (!r.Test(read)) list.Add(r.Words);
            return list.ToArray();
        }

        /// <summary>One condition: in plain words ("Brass Key", "trust at least 2") and as a test of the story's variables.</summary>
        public sealed class Requirement
        {
            public readonly string Words;
            public readonly Func<Func<string, object>, bool> Test;
            public Requirement(string words, Func<Func<string, object>, bool> test)
            {
                Words = words;
                Test = test;
            }
        }

        /// <summary>Whether an ink value is true (items are ink Booleans named has_&lt;item&gt;).</summary>
        public static bool Has(object v)
        {
            if (v is bool b) return b;
            if (v is int i) return i != 0;
            if (v is float f) return f != 0f;
            return false;
        }

        /// <summary>Compares an ink value the way ink does: numbers as numbers, text and true/false as they are.</summary>
        public static bool Compare(object a, string op, object b)
        {
            if (IsNumber(a) && IsNumber(b))
            {
                var x = Convert.ToDouble(a);
                var y = Convert.ToDouble(b);
                switch (op)
                {
                    case "==": return x == y;
                    case "!=": return x != y;
                    case "<": return x < y;
                    case "<=": return x <= y;
                    case ">": return x > y;
                    case ">=": return x >= y;
                }
                return false;
            }
            var same = Equals(a, b) || (a is bool ab && IsNumber(b) && ab == (Convert.ToDouble(b) != 0));
            if (op == "==") return same;
            if (op == "!=") return !same;
            if (a is string sa && b is string sb)
            {
                var c = string.CompareOrdinal(sa, sb);
                switch (op)
                {
                    case "<": return c < 0;
                    case "<=": return c <= 0;
                    case ">": return c > 0;
                    case ">=": return c >= 0;
                }
            }
            return false;
        }

        static bool IsNumber(object v) => v is int || v is float || v is double || v is long;
    }
}
`;

const CUE_PLAYER_CS = `using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;
using UnityEngine.Events;

namespace __NAMESPACE__
{
    /// <summary>
    /// Plays the story's cues without code. A writer adds cues in Narrative Bridge (#music:calm, #sound:door_creak,
    /// #shake:0.5, or any name of their own; StoryInfo.Cues lists them), and this does what each one is set to: play
    /// or stop music (fading between tracks), play a sound, loop an ambience, shake the camera, or only raise its
    /// event. A cue's value picks the clip with that name. Add it with Tools → Narrative Bridge → __MENU_TITLE__ →
    /// Add Cue Player, which lists every cue in the story.
    /// </summary>
    [AddComponentMenu("Narrative Bridge/__MENU_TITLE__/Narrative Cue Player")]
    public class NarrativeCuePlayer : MonoBehaviour
    {
        public enum CueAction { EventOnly, PlayMusic, StopMusic, PlaySound, PlayAmbience, StopAmbience, ShakeCamera }

        [Serializable] public class CueEvent : UnityEvent<string> { }
        [Serializable] public class AnyCueEvent : UnityEvent<string, string> { }

        [Serializable]
        public class Cue
        {
            [Tooltip("The cue's name as the writer gave it (one of StoryInfo.Cues), e.g. music, sound or shake.")]
            public string name;
            public CueAction action = CueAction.EventOnly;
            [Tooltip("Clips to choose from: the cue's value picks the one with that name (#music:calm plays \\"calm\\"), else the first.")]
            public List<AudioClip> clips = new List<AudioClip>();
            [Range(0f, 1f)] public float volume = 1f;
            [Tooltip("Raised with the cue's value, for anything else your game does.")]
            public CueEvent onCue = new CueEvent();
        }

        public NarrativeController controller;
        public List<Cue> cues = new List<Cue>();

        [Header("Sound")]
        [Tooltip("Optional AudioSources, e.g. routed through your game's mixer. Made when empty.")]
        public AudioSource musicSource;
        public AudioSource soundSource;
        public AudioSource ambienceSource;
        [Tooltip("Seconds to fade out one music track and in the next.")]
        [Min(0f)] public float musicFade = 1f;

        [Header("Camera shake")]
        [Tooltip("What shakes. Empty: the main camera.")]
        public Transform shakeTarget;
        [Min(0f)] public float shakeSeconds = 0.4f;
        [Tooltip("How far it moves at strength 1 (a shake cue's value, 0 to 1; 0.5 when it has none).")]
        [Min(0f)] public float shakeDistance = 0.3f;

        [Tooltip("Play the sounds the writer attached to cues in Narrative Bridge (StoryInfo.CueSoundTags) when a cue has no clip of its own named by its value.")]
        public bool playStorySounds = true;

        [Tooltip("Every cue, listed or not: its name and value.")]
        public AnyCueEvent onAnyCue = new AnyCueEvent();

        /// <summary>Every cue the story reaches, listed or not: its name and value.</summary>
        public event Action<string, string> CuePlayed;

        /// <summary>The music track playing now, or null.</summary>
        public AudioClip CurrentMusic => musicSource != null && musicSource.isPlaying ? musicSource.clip : pendingMusic;

        AudioClip pendingMusic;
        Coroutine musicFader, shaker;
        Vector3 shakeHome;
        Transform shaking;

        void Awake()
        {
            if (controller == null) controller = GetComponent<NarrativeController>();
        }

        void OnEnable()
        {
            if (controller == null) controller = GetComponent<NarrativeController>();
            if (controller != null) controller.TagFound += OnTag;
        }

        void OnDisable()
        {
            if (controller != null) controller.TagFound -= OnTag;
            StopShake();
        }

        void OnTag(string tag)
        {
            var colon = tag.IndexOf(':');
            Play(colon < 0 ? tag.Trim() : tag.Substring(0, colon).Trim(), colon < 0 ? "" : tag.Substring(colon + 1).Trim());
        }

        /// <summary>Plays a cue by name and value, as if the story had reached it.</summary>
        public void Play(string name, string value)
        {
            value = value ?? "";
            CuePlayed?.Invoke(name, value);
            onAnyCue.Invoke(name, value);
            foreach (var cue in cues)
            {
                if (cue == null || !string.Equals(cue.name, name, StringComparison.OrdinalIgnoreCase)) continue;
                Run(cue, value, string.IsNullOrEmpty(value) ? name : name + ":" + value);
                cue.onCue.Invoke(value);
            }
        }

        void Run(Cue cue, string value, string tag)
        {
            switch (cue.action)
            {
                case CueAction.PlayMusic:
                    // A music cue with no value stops the music.
                    if (string.IsNullOrEmpty(value)) StopMusic();
                    else WithClip(cue, value, tag, clip => PlayMusic(clip, cue.volume));
                    break;
                case CueAction.StopMusic:
                    StopMusic();
                    break;
                case CueAction.PlaySound:
                    WithClip(cue, value, tag, sound => { if (sound != null) Source(ref soundSource, "Cue Sounds", false).PlayOneShot(sound, cue.volume); });
                    break;
                case CueAction.PlayAmbience:
                    // An ambience cue with no value stops the ambience.
                    if (string.IsNullOrEmpty(value)) { if (ambienceSource != null) ambienceSource.Stop(); break; }
                    WithClip(cue, value, tag, loop =>
                    {
                        if (loop == null) return;
                        var ambience = Source(ref ambienceSource, "Cue Ambience", true);
                        if (ambience.clip == loop && ambience.isPlaying) return;
                        ambience.clip = loop;
                        ambience.volume = cue.volume;
                        if (Application.isPlaying) ambience.Play();
                    });
                    break;
                case CueAction.StopAmbience:
                    if (ambienceSource != null) ambienceSource.Stop();
                    break;
                case CueAction.ShakeCamera:
                    Shake(float.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var strength) ? Mathf.Clamp01(strength) : 0.5f);
                    break;
            }
        }

        /// <summary>
        /// The clip for a cue, then use(clip): the cue's own clip named by the value; else the sound the writer attached to
        /// this cue in Narrative Bridge (loaded without waiting); else the cue's first clip; null when there's none.
        /// </summary>
        void WithClip(Cue cue, string value, string tag, Action<AudioClip> use)
        {
            if (!string.IsNullOrEmpty(value))
                foreach (var c in cue.clips) if (c != null && string.Equals(c.name, value, StringComparison.OrdinalIgnoreCase)) { use(c); return; }
            var file = playStorySounds ? StorySound(tag) : null;
            if (file != null)
            {
                NarrativeController.LoadVoiceClipAsync(file, clip => use(clip != null ? clip : FirstClip(cue)));
                return;
            }
            if (!string.IsNullOrEmpty(value) && cue.clips.Count > 0) Debug.LogWarning("[NarrativeBridge] No clip called " + value + " for the " + cue.name + " cue; playing its first clip.");
            use(FirstClip(cue));
        }

        static AudioClip FirstClip(Cue cue)
        {
            foreach (var c in cue.clips) if (c != null) return c;
            return null;
        }

        /// <summary>The clip the writer attached to a cue tag (e.g. "music:calm"), or null.</summary>
        public static string StorySound(string tag)
        {
            var i = Array.IndexOf(StoryInfo.CueSoundTags, tag);
            return i >= 0 ? StoryInfo.CueSoundFiles[i] : null;
        }

        /// <summary>Whether the writer attached a sound to any cue with this name.</summary>
        public static bool HasStorySounds(string name)
        {
            foreach (var t in StoryInfo.CueSoundTags) if (t == name || t.StartsWith(name + ":", StringComparison.Ordinal)) return true;
            return false;
        }

        AudioSource Source(ref AudioSource source, string name, bool loop)
        {
            if (source == null)
            {
                var go = new GameObject(name);
                go.transform.SetParent(transform, false);
                source = go.AddComponent<AudioSource>();
                source.playOnAwake = false;
            }
            source.loop = loop;
            return source;
        }

        // ---- Music: one track at a time, faded -------------------------------------------------

        public void PlayMusic(AudioClip clip, float volume = 1f)
        {
            var music = Source(ref musicSource, "Cue Music", true);
            if (clip == null || (music.clip == clip && music.isPlaying)) return;
            pendingMusic = clip;
            if (musicFader != null) StopCoroutine(musicFader);
            if (!Application.isPlaying || musicFade <= 0f || !isActiveAndEnabled)
            {
                music.clip = clip;
                music.volume = volume;
                if (Application.isPlaying) music.Play();
                return;
            }
            musicFader = StartCoroutine(FadeMusic(clip, volume));
        }

        public void StopMusic()
        {
            pendingMusic = null;
            if (musicSource == null) return;
            if (musicFader != null) StopCoroutine(musicFader);
            if (!Application.isPlaying || musicFade <= 0f || !isActiveAndEnabled) { musicSource.Stop(); return; }
            musicFader = StartCoroutine(FadeMusic(null, 0f));
        }

        IEnumerator FadeMusic(AudioClip next, float volume)
        {
            var music = musicSource;
            var half = musicFade * 0.5f;
            if (music.isPlaying)
            {
                var from = music.volume;
                for (float t = 0f; t < half; t += Time.unscaledDeltaTime) { music.volume = Mathf.Lerp(from, 0f, t / half); yield return null; }
                music.Stop();
            }
            if (next != null)
            {
                music.clip = next;
                music.volume = 0f;
                music.Play();
                for (float t = 0f; t < half; t += Time.unscaledDeltaTime) { music.volume = Mathf.Lerp(0f, volume, t / half); yield return null; }
                music.volume = volume;
            }
            musicFader = null;
        }

        // ---- Camera shake -------------------------------------------------------------------

        public void Shake(float strength)
        {
            var target = shakeTarget != null ? shakeTarget : (Camera.main != null ? Camera.main.transform : null);
            if (target == null || !Application.isPlaying || !isActiveAndEnabled) return;
            StopShake();
            shaking = target;
            shakeHome = target.localPosition;
            shaker = StartCoroutine(ShakeFor(strength));
        }

        IEnumerator ShakeFor(float strength)
        {
            for (float t = 0f; t < shakeSeconds && shaking != null; t += Time.unscaledDeltaTime)
            {
                shaking.localPosition = shakeHome + UnityEngine.Random.insideUnitSphere * shakeDistance * strength * (1f - t / shakeSeconds);
                yield return null;
            }
            StopShake();
        }

        void StopShake()
        {
            if (shaker != null) StopCoroutine(shaker);
            shaker = null;
            if (shaking != null) shaking.localPosition = shakeHome;
            shaking = null;
        }

        /// <summary>A sensible action for a cue's name (music, sound, ambience, shake…), as Add Cue Player sets them.</summary>
        public static CueAction Guess(string name)
        {
            var n = (name ?? "").ToLowerInvariant();
            if (n.Contains("stop_music") || n == "silence") return CueAction.StopMusic;
            if (n.Contains("stop_ambience")) return CueAction.StopAmbience;
            if (n.Contains("music") || n == "song" || n == "track") return CueAction.PlayMusic;
            if (n.Contains("ambien") || n == "weather") return CueAction.PlayAmbience;
            if (n.Contains("sound") || n == "sfx") return CueAction.PlaySound;
            if (n.Contains("shake") || n == "rumble") return CueAction.ShakeCamera;
            return CueAction.EventOnly;
        }
    }
}
`;

const SAVE_STORAGE_CS = `using System;
using System.IO;
using UnityEngine;

namespace __NAMESPACE__
{
    /// <summary>
    /// Where save slots are kept. Implement it on a MonoBehaviour and set the controller's Save Storage to use your
    /// game's own saves (Steam Cloud, a console's save data, your save file); keys are short names like "slot-1".
    /// </summary>
    public interface ISaveStorage
    {
        void Write(string key, string data);
        /// <summary>The data saved under key, or null.</summary>
        string Read(string key);
        void Delete(string key);
    }

    /// <summary>The default: one small JSON file per slot in Application.persistentDataPath/NarrativeBridge/&lt;story&gt;/.</summary>
    public class FileSaveStorage : ISaveStorage
    {
        public readonly string Folder;

        public FileSaveStorage(string folder = null)
        {
            Folder = folder ?? System.IO.Path.Combine(Application.persistentDataPath, "NarrativeBridge", StoryInfo.PackageName);
        }

        string FileFor(string key) => System.IO.Path.Combine(Folder, key + ".json");

        public void Write(string key, string data)
        {
            Directory.CreateDirectory(Folder);
            // Write a new file and swap it in, so a crash mid-save never leaves half a save.
            var file = FileFor(key);
            var temp = file + ".tmp";
            File.WriteAllText(temp, data);
            if (File.Exists(file)) File.Delete(file);
            File.Move(temp, file);
        }

        public string Read(string key)
        {
            var file = FileFor(key);
            return File.Exists(file) ? File.ReadAllText(file) : null;
        }

        public void Delete(string key)
        {
            var file = FileFor(key);
            if (File.Exists(file)) File.Delete(file);
        }
    }
}
`;

const LOCALIZATION_CS = `using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;
#if NARRATIVE_BRIDGE_LOCALIZATION
using UnityEngine.Localization.Settings;
#endif

namespace __NAMESPACE__
{
    /// <summary>
    /// Shows the story in another language. The package's translation sheet (Resources: StoryInfo.TranslationsResource,
    /// a CSV) lists every piece of text the player can see with a key made from its text; translators add a column per
    /// language ("fr", "de"…). Language picks one (or "" for the story as written); the story panel's Settings menu has
    /// it too. With Unity's Localization package, Tools → Narrative Bridge → __MENU_TITLE__ → Create Localization Tables
    /// makes a String Table Collection from the sheet, and the story then follows the selected locale.
    /// </summary>
    public static class NarrativeLocalization
    {
        const string LanguageKey = "NarrativeBridge.Language";
        static Dictionary<string, string[]> table;
        static string[] languages = new string[0];
        static TextAsset sheet;
        static bool loaded, languageLoaded;
        static string language = "";

        /// <summary>Raised when the language (or the sheet) changes: the story and its panel show the new words.</summary>
        public static event Action Changed;

        /// <summary>The languages the sheet has (its column names after "source"), not counting the story's own.</summary>
        public static IReadOnlyList<string> Languages
        {
            get
            {
                EnsureLoaded();
                return languages;
            }
        }

        /// <summary>The language shown: one of Languages, or "" for the story as written. Kept in PlayerPrefs; the first time, the player's system language if the sheet has it.</summary>
        public static string Language
        {
            get
            {
                LoadLanguage();
                return language;
            }
            set
            {
                LoadLanguage();
                value = value ?? "";
                if (value == language) return;
                language = value;
                PlayerPrefs.SetString(LanguageKey, value);
                Changed?.Invoke();
            }
        }

        /// <summary>Uses another sheet (a CSV TextAsset like Translations.csv, e.g. your translators' newest); null goes back to the package's.</summary>
        public static void UseSheet(TextAsset csv)
        {
            sheet = csv;
            loaded = false;
            Changed?.Invoke();
        }

        /// <summary>The text in the current language, or as written when there's no translation for it.</summary>
        public static string Translate(string text)
        {
            if (string.IsNullOrEmpty(text)) return text;
#if NARRATIVE_BRIDGE_LOCALIZATION
            if (UseUnityLocalization)
            {
                var fromTables = FromUnity(Key(text));
                if (!string.IsNullOrEmpty(fromTables)) return fromTables;
            }
#endif
            var lang = Language;
            if (string.IsNullOrEmpty(lang)) return text;
            EnsureLoaded();
            var column = Array.IndexOf(languages, lang);
            if (column < 0) return text;
            return table.TryGetValue(Key(text), out var row) && column < row.Length && !string.IsNullOrEmpty(row[column]) ? row[column] : text;
        }

        /// <summary>The sheet's key for a text: its words with spaces tidied, hashed (FNV-1a), e.g. "nb_1c3f9a2e". The same as Narrative Bridge's.</summary>
        public static string Key(string text)
        {
            var t = Normalise(text);
            uint h = 0x811c9dc5;
            for (int i = 0; i < t.Length; i++)
            {
                h ^= t[i];
                h = unchecked(h * 0x01000193);
            }
            return "nb_" + h.ToString("x8");
        }

        static string Normalise(string text)
        {
            var sb = new StringBuilder(text.Length);
            var space = false;
            foreach (var ch in text)
            {
                if (char.IsWhiteSpace(ch)) { space = sb.Length > 0; continue; }
                if (space) sb.Append(' ');
                space = false;
                sb.Append(ch);
            }
            return sb.ToString();
        }

        /// <summary>A language's own name for itself (fr → Français), or the code; "" is the story's own language.</summary>
        public static string DisplayName(string code)
        {
            if (string.IsNullOrEmpty(code)) code = StoryInfo.SourceLanguage;
            try
            {
                var name = CultureInfo.GetCultureInfo(code).NativeName;
                if (!string.IsNullOrEmpty(name) && name.IndexOf("Unknown", StringComparison.OrdinalIgnoreCase) < 0) return char.ToUpper(name[0]) + name.Substring(1);
            }
            catch (Exception) { }
            return code;
        }

        /// <summary>The sheet's rows: the header (key, kind, passage, source, languages…) first. For tools such as Create Localization Tables.</summary>
        public static List<string[]> ReadSheet(TextAsset csv = null)
        {
            var asset = csv != null ? csv : (sheet != null ? sheet : Resources.Load<TextAsset>(StoryInfo.TranslationsResource));
            return asset != null ? ParseCsv(asset.text) : new List<string[]>();
        }

        static void EnsureLoaded()
        {
            if (loaded) return;
            loaded = true;
            table = new Dictionary<string, string[]>();
            languages = new string[0];
            var rows = ReadSheet();
            if (rows.Count == 0) return;
            var header = rows[0];
            var first = Array.IndexOf(header, "source") + 1;
            if (first <= 0) return;
            languages = new string[Math.Max(0, header.Length - first)];
            for (int i = 0; i < languages.Length; i++) languages[i] = header[first + i].Trim();
            for (int r = 1; r < rows.Count; r++)
            {
                var row = rows[r];
                if (row.Length == 0 || string.IsNullOrEmpty(row[0])) continue;
                var values = new string[languages.Length];
                for (int i = 0; i < values.Length; i++) values[i] = first + i < row.Length ? row[first + i] : "";
                table[row[0]] = values;
            }
        }

        static void LoadLanguage()
        {
            if (languageLoaded) return;
            languageLoaded = true;
            if (PlayerPrefs.HasKey(LanguageKey)) { language = PlayerPrefs.GetString(LanguageKey, ""); return; }
            // Nobody has chosen yet: the player's system language, if there's a translation into it.
            var system = SystemLanguageCode();
            EnsureLoaded();
            language = system != null && system != StoryInfo.SourceLanguage && Array.IndexOf(languages, system) >= 0 ? system : "";
        }

        static string SystemLanguageCode()
        {
            switch (Application.systemLanguage)
            {
                case SystemLanguage.English: return "en";
                case SystemLanguage.French: return "fr";
                case SystemLanguage.German: return "de";
                case SystemLanguage.Spanish: return "es";
                case SystemLanguage.Italian: return "it";
                case SystemLanguage.Portuguese: return "pt";
                case SystemLanguage.Dutch: return "nl";
                case SystemLanguage.Polish: return "pl";
                case SystemLanguage.Russian: return "ru";
                case SystemLanguage.Japanese: return "ja";
                case SystemLanguage.Korean: return "ko";
                case SystemLanguage.ChineseSimplified: return "zh-Hans";
                case SystemLanguage.ChineseTraditional: return "zh-Hant";
                case SystemLanguage.Turkish: return "tr";
                case SystemLanguage.Swedish: return "sv";
                default: return null;
            }
        }

        /// <summary>Reads CSV: commas between fields, "quoted" fields may hold commas, quotes ("") and line breaks.</summary>
        public static List<string[]> ParseCsv(string text)
        {
            var rows = new List<string[]>();
            var row = new List<string>();
            var field = new StringBuilder();
            var quoted = false;
            for (int i = 0; i < text.Length; i++)
            {
                var c = text[i];
                if (quoted)
                {
                    if (c == '"' && i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; }
                    else if (c == '"') quoted = false;
                    else field.Append(c);
                    continue;
                }
                if (c == '"' && field.Length == 0) quoted = true;
                else if (c == ',') { row.Add(field.ToString()); field.Clear(); }
                else if (c == '\\n' || c == '\\r')
                {
                    if (c == '\\r' && i + 1 < text.Length && text[i + 1] == '\\n') i++;
                    row.Add(field.ToString());
                    field.Clear();
                    if (row.Count > 1 || row[0].Length > 0) rows.Add(row.ToArray());
                    row = new List<string>();
                }
                else if (c != '\\uFEFF') field.Append(c);
            }
            if (field.Length > 0 || row.Count > 0)
            {
                row.Add(field.ToString());
                rows.Add(row.ToArray());
            }
            return rows;
        }

#if NARRATIVE_BRIDGE_LOCALIZATION
        /// <summary>Read translations from Unity's Localization package (the tables Create Localization Tables makes), following its selected locale.</summary>
        public static bool UseUnityLocalization = true;
        static bool hooked;

        static string FromUnity(string key)
        {
            if (!Application.isPlaying || !LocalizationSettings.HasSettings) return null;
            if (!hooked)
            {
                hooked = true;
                LocalizationSettings.SelectedLocaleChanged += _ => Changed?.Invoke();
            }
            var locale = LocalizationSettings.SelectedLocale;
            if (locale == null || locale.Identifier.Code == StoryInfo.SourceLanguage) return null;
            var strings = LocalizationSettings.StringDatabase.GetTable(StoryInfo.StringTableName, locale);
            var entry = strings != null ? strings.GetEntry(key) : null;
            return entry != null ? entry.GetLocalizedString() : null;
        }
#endif
    }
}
`;

const CONTROLLER_CS = `using System;
using System.Collections.Generic;
using Ink.Runtime;
using UnityEngine;
using UnityEngine.Events;
#if NARRATIVE_BRIDGE_ADDRESSABLES
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;
#endif

namespace __NAMESPACE__
{
    /// <summary>
    /// Runs the story with the ink runtime from Ink Unity Integration: advances text, presents choices and
    /// Continue breaks, exposes approved variables, synchronises inventory with your game and saves/restores
    /// state with story-version checks. NarrativeView draws it as a themed uGUI story panel; your own UI and
    /// game systems can use the C# events or the Inspector events below instead.
    /// Includes an optional bare-bones IMGUI demo (drawDemoUI).
    /// </summary>
    [AddComponentMenu("Narrative Bridge/__MENU_TITLE__/Narrative Controller")]
    public class NarrativeController : MonoBehaviour
    {
#if NARRATIVE_BRIDGE_INK_FILE
        [Tooltip("Optional: an InkFile imported by Ink Unity Integration, to run your own edited copy of the story.")]
        public Ink.UnityIntegration.InkFile inkFile;
#endif

        [Tooltip("Optional compiled ink JSON. Leave empty to use the story in this package.")]
        public TextAsset storyJson;

        [Tooltip("Optional component implementing IInventoryAuthority. When set, your game owns item possession.")]
        public MonoBehaviour inventoryAuthority;

        [Tooltip("Start when this object wakes. Turn off to start it yourself with StartStory() or StartAt(passage).")]
        public bool startOnAwake = true;

        [Tooltip("Draw the bare-bones IMGUI demo. Off when a NarrativeView or your own UI draws the story.")]
        public bool drawDemoUI = true;

        [Tooltip("Play the recorded dialogue clips (#audio tags) that come with the story.")]
        public bool playVoiceClips = true;

        [Tooltip("Optional AudioSource for voice clips, e.g. one routed through your game's mixer. One is added when empty.")]
        public AudioSource voiceSource;

        [Tooltip("Volume of the voice clips (the story panel sets it from its theme).")]
        [Range(0f, 1f)] public float voiceVolume = 1f;

        [Tooltip("Optional translation sheet (a CSV like the package's Translations.csv, with a column per language). Empty: the package's. See NarrativeLocalization.")]
        public TextAsset translations;

        [Header("Saves")]
        [Tooltip("Save slots the story panel's Save and Load offer. 0 keeps the single quick save (SaveToPrefs).")]
        [Range(0, 9)] public int saveSlots = 3;
        [Tooltip("Keep an autosave (slot 0) each time the reader reaches a new passage, while the game plays.")]
        public bool autosave = true;
        [Tooltip("Optional component implementing ISaveStorage, for your game's own saves. Files in Application.persistentDataPath when empty.")]
        public MonoBehaviour saveStorage;

        [Serializable] public class LineEvent : UnityEvent<string, string> { }
        [Serializable] public class TextEvent : UnityEvent<string> { }
        [Serializable] public class VariableEvent : UnityEvent<string, string> { }

        [Header("Events (wire these up in the Inspector)")]
        [Tooltip("A line of the story: the speaker (empty for narration) and the text.")]
        public LineEvent onLine = new LineEvent();
        [Tooltip("Choices are waiting: call Choose(index).")]
        public UnityEvent onChoices = new UnityEvent();
        [Tooltip("A Continue break is waiting: call Continue().")]
        public UnityEvent onContinue = new UnityEvent();
        public UnityEvent onEnded = new UnityEvent();
        [Tooltip("A tag the story uses that Narrative Bridge doesn't, e.g. #shake or #music:calm.")]
        public TextEvent onTag = new TextEvent();
        [Tooltip("A story variable or item changed: its name and new value.")]
        public VariableEvent onVariableChanged = new VariableEvent();
        [Tooltip("The dialogue reached an exit to the game: its name. Play your gameplay, then call Resume() or ResumeAt(passage).")]
        public TextEvent onExit = new TextEvent();
        [Tooltip("The game resumed the dialogue after an exit.")]
        public UnityEvent onResume = new UnityEvent();

        public struct Line
        {
            /// <summary>The speaker's name as written in the story, or null for narration.</summary>
            public string Speaker;
            /// <summary>The speaker's character id (the #speaker tag), e.g. for LoadPortrait; null for narration.</summary>
            public string SpeakerId;
            public string Text;
            public List<string> Tags;
            /// <summary>The scene heading this line opens (from #scene), or null.</summary>
            public string Scene;
            /// <summary>A stage direction for the speaker (from #paren), or null.</summary>
            public string Paren;
            /// <summary>The scene picture this line opens (file name from #image), or null. See LoadPicture.</summary>
            public string Image;
            /// <summary>A choice the player made (shown in the transcript), not story text.</summary>
            public bool IsChoice;
            public bool IsTransition;
            /// <summary>A cutscene line (from #cutscene): shown one at a time, going on by itself.</summary>
            public bool IsCutscene;
            /// <summary>The text, speaker, scene and stage direction as written (Text and the rest are in NarrativeLocalization.Language).</summary>
            public string SourceText, SourceSpeaker, SourceScene, SourceParen;
        }

        /// <summary>The text of a Continue break's only choice (see the Ink conventions).</summary>
        public const string ContinueText = "Continue";

        /// <summary>An exit to the game is a lone choice with this text before the exit's name (see the Ink conventions).</summary>
        public const string ExitPrefix = "Back to the game: ";

        public event Action<Line> LineShown;
        /// <summary>Real choices to make. A Continue break raises ContinueShown instead.</summary>
        public event Action<IReadOnlyList<Choice>> ChoicesShown;
        /// <summary>A Continue break: the reader continues (Continue()) to see what follows.</summary>
        public event Action ContinueShown;
        public event Action StoryEnded;
        public event Action<string> RuntimeError;
        /// <summary>The transcript was cleared (start, restart or load): redraw from scratch.</summary>
        public event Action Restarted;
        public event Action<string> StatusChanged;
        /// <summary>A tag on a line that isn't one of Narrative Bridge's own (speaker, scene, paren, image, audio, transition).</summary>
        public event Action<string> TagFound;
        /// <summary>A story variable or item variable changed (name, new value). Raised for all of them after a load.</summary>
        public event Action<string, object> VariableChanged;
        /// <summary>
        /// The dialogue reached an exit to the game (its name, one of StoryInfo.Exits): it waits while your game
        /// plays, until you call Resume() to go on from here, or ResumeAt(passage) to go on somewhere else.
        /// Set story variables or items first (SetVariable, your inventory) to tell the story what happened.
        /// </summary>
        public event Action<string> ExitReached;
        /// <summary>The game resumed the dialogue after an exit.</summary>
        public event Action Resumed;

        public Story Story { get; private set; }
        public bool HasEnded { get; private set; }
        public IReadOnlyList<Line> Transcript => transcript;
        public string Status => status;
        /// <summary>The passage the story was started at (StartAt), or null when it started from the beginning.</summary>
        public string StartPassage { get; private set; }

        /// <summary>The story is at a Continue break: its only choice is Continue.</summary>
        public bool IsWaitingForContinue => Story != null && Story.currentChoices.Count == 1 && Story.currentChoices[0].text == ContinueText;

        /// <summary>The exit to the game the dialogue is waiting at, or null.</summary>
        public string CurrentExit => Story != null && Story.currentChoices.Count == 1 && Story.currentChoices[0].text.StartsWith(ExitPrefix, StringComparison.Ordinal) ? Story.currentChoices[0].text.Substring(ExitPrefix.Length) : null;

        /// <summary>The dialogue has handed over to the game and waits for Resume() or ResumeAt(passage).</summary>
        public bool IsAtExit => CurrentExit != null;

        /// <summary>The passage (ink knot, one of StoryInfo.Passages) the reader is in, or null before the story starts.</summary>
        public string CurrentPassage
        {
            get
            {
                if (Story != null && Story.currentChoices.Count > 0)
                {
                    var knot = KnotOf(Story.currentChoices[0].sourcePath);
                    if (knot != null) return knot;
                }
                return lastPassage;
            }
        }

        /// <summary>A choice the reader can't take yet: its text, and what it needs in plain words.</summary>
        public struct LockedChoice
        {
            public string Text;
            public string Needs;
        }

        /// <summary>
        /// The choices of the current passage that need an item or a value the reader doesn't have (see
        /// StoryInfo.GatedChoices). Ink leaves them out of Story.currentChoices; show them greyed out if you like.
        /// Empty at a Continue break, an exit or the ending.
        /// </summary>
        public IReadOnlyList<LockedChoice> LockedChoices
        {
            get
            {
                locked.Clear();
                if (Story == null || HasEnded || IsAtExit || IsWaitingForContinue || Story.currentChoices.Count == 0) return locked;
                var passage = CurrentPassage;
                // While a forced choice is on offer, it's the only way on: nothing is shown as locked.
                if (Story.currentChoices.Exists(c => System.Array.IndexOf(StoryInfo.ForcedChoices, passage + "\\n" + c.text) >= 0)) return locked;
                foreach (var g in StoryInfo.GatedChoices)
                {
                    if (g.Passage != passage || Story.currentChoices.Exists(c => c.text == g.Text)) continue;
                    var missing = g.Missing(ReadVariable);
                    if (missing.Length == 0) continue;
                    for (int i = 0; i < missing.Length; i++) missing[i] = NarrativeLocalization.Translate(missing[i]);
                    locked.Add(new LockedChoice { Text = NarrativeLocalization.Translate(g.Text), Needs = string.Join(", ", missing) });
                }
                return locked;
            }
        }

        readonly List<LockedChoice> locked = new List<LockedChoice>();
        string lastPassage;

        /// <summary>A story variable's value by name, or null (for conditions; GetVariable checks the name).</summary>
        object ReadVariable(string name)
        {
            if (Story == null || !Story.variablesState.GlobalVariableExistsWithName(name)) return null;
            return Story.variablesState[name];
        }

        static string KnotOf(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;
            var dot = path.IndexOf('.');
            var knot = dot < 0 ? path : path.Substring(0, dot);
            return Array.IndexOf(StoryInfo.Passages, knot) >= 0 ? knot : null;
        }

        void NotePassage()
        {
            var knot = KnotOf(Story.state.currentPathString);
            if (knot != null) lastPassage = knot;
        }

        const string SaveKey = "NarrativeBridge.Save." + StoryInfo.ProjectId;
        readonly List<Line> transcript = new List<Line>();
        IInventoryAuthority authority;
        AudioSource voice;
        // Voice clips to play in order; one may still be loading (Addressables).
        class VoiceItem
        {
            public AudioClip Clip;
            public bool Loading;
        }
        readonly Queue<VoiceItem> voiceQueue = new Queue<VoiceItem>();
        bool syncing, silent;
        string status = "";
        Vector2 scroll;

        // The text of every choice made since the start, so a save can carry over to a revised story.
        readonly List<string> choicePath = new List<string>();

        /// <summary>Set by TryLoadState when it carried a save over from another story version; null otherwise.</summary>
        public string LoadNote { get; private set; }

        [Serializable]
        class SaveData
        {
            public string storyVersion;
            public string inkState;
            public List<string> choicePath;
            public string startPassage;
            // For save slots: when, where, and the last line read.
            public string savedAt;
            public string passage;
            public string excerpt;
        }

        void Awake()
        {
            authority = inventoryAuthority as IInventoryAuthority;
            if (inventoryAuthority != null && authority == null)
                Debug.LogError("[NarrativeBridge] inventoryAuthority does not implement IInventoryAuthority.", this);
            voice = voiceSource != null ? voiceSource : GetComponent<AudioSource>();
            if (voice == null) voice = gameObject.AddComponent<AudioSource>();
            voice.playOnAwake = false;
            if (translations != null) NarrativeLocalization.UseSheet(translations);
            if (startOnAwake) StartStory();
        }

        void OnEnable() => NarrativeLocalization.Changed += Relocalize;
        void OnDisable() => NarrativeLocalization.Changed -= Relocalize;

        /// <summary>Puts the transcript into the current language again (after NarrativeLocalization.Language changes).</summary>
        public void Relocalize()
        {
            for (int i = 0; i < transcript.Count; i++) transcript[i] = Localize(transcript[i]);
        }

        static Line Localize(Line l)
        {
            l.Text = NarrativeLocalization.Translate(l.SourceText ?? l.Text);
            if (l.SourceSpeaker != null) l.Speaker = NarrativeLocalization.Translate(l.SourceSpeaker);
            if (l.SourceScene != null) l.Scene = NarrativeLocalization.Translate(l.SourceScene);
            if (l.SourceParen != null) l.Paren = NarrativeLocalization.Translate(l.SourceParen);
            return l;
        }

        /// <summary>A choice's text in the current language (choose it by index with Choose).</summary>
        public static string ChoiceText(Choice choice) => NarrativeLocalization.Translate(choice.text);

        /// <summary>Starts (or restarts) the story from the beginning.</summary>
        public void StartStory() => Begin(null);

        /// <summary>Starts (or restarts) the story at a passage, e.g. when the player talks to someone. See StoryInfo.Passages.</summary>
        public void StartAt(string passage)
        {
            if (Array.IndexOf(StoryInfo.Passages, passage) < 0) { ReportError("There is no passage called " + passage + "."); return; }
            Begin(passage);
        }

        void Begin(string passage)
        {
            string json = null;
#if NARRATIVE_BRIDGE_INK_FILE
            if (inkFile != null && inkFile.isCompiled) json = inkFile.storyJson;
            else if (inkFile != null) Debug.LogWarning("[NarrativeBridge] " + inkFile.name + " has not compiled; using the story in the package.", this);
#endif
            if (json == null)
            {
                var asset = storyJson != null ? storyJson : Resources.Load<TextAsset>(StoryInfo.CompiledResource);
                if (asset != null) json = asset.text;
            }
            if (json == null)
            {
                ReportError("No compiled story found. Assign storyJson or keep Resources/" + StoryInfo.CompiledResource + ".json.");
                return;
            }
            Story = new Story(json);
            Story.onError += (message, type) =>
            {
                if (type == Ink.ErrorType.Error) ReportError(message);
                else Debug.LogWarning("[NarrativeBridge] " + message);
            };
            foreach (var v in StoryInfo.ItemVariables) Story.ObserveVariable(v, OnVariableObserved);
            foreach (var v in StoryInfo.Variables) Story.ObserveVariable(v, OnVariableObserved);
            choicePath.Clear();
            transcript.Clear();
            HasEnded = false;
            StartPassage = passage;
            lastPassage = passage;
            SetStatus("");
            StopVoice();
            if (passage != null) Story.ChoosePathString(passage);
            Restarted?.Invoke();
            Advance();
        }

        /// <summary>Goes on past a Continue break.</summary>
        public void Continue()
        {
            if (IsWaitingForContinue) Choose(0);
        }

        /// <summary>Goes on after an exit to the game, from where the dialogue left off.</summary>
        public void Resume()
        {
            if (!IsAtExit) return;
            Resumed?.Invoke();
            onResume.Invoke();
            Choose(0);
        }

        /// <summary>
        /// Goes on after an exit at another passage (e.g. "won_fight" or "lost_fight"), keeping the story's
        /// variables and items. Also works when the dialogue isn't at an exit, to jump there. See StoryInfo.Passages.
        /// </summary>
        public void ResumeAt(string passage)
        {
            if (Story == null) return;
            if (Array.IndexOf(StoryInfo.Passages, passage) < 0) { ReportError("There is no passage called " + passage + "."); return; }
            var exited = IsAtExit;
            // Saves record the jump, so a save carries over to a revised story too.
            choicePath.Add(JumpMark + passage);
            Story.ChoosePathString(passage);
            StopVoice();
            if (exited) { Resumed?.Invoke(); onResume.Invoke(); }
            Advance();
        }

        /// <summary>How a jump (ResumeAt) is written in a save's choice path.</summary>
        const string JumpMark = "→";

        public void Choose(int index)
        {
            if (Story == null || index < 0 || index >= Story.currentChoices.Count) return;
            // A Continue break or an exit leaves no trace in the transcript: the page simply goes on.
            if (!IsWaitingForContinue && !IsAtExit)
                transcript.Add(Localize(new Line { Speaker = null, Text = Story.currentChoices[index].text, SourceText = Story.currentChoices[index].text, Tags = new List<string> { "choice" }, IsChoice = true }));
            choicePath.Add(Story.currentChoices[index].text);
            Story.ChooseChoiceIndex(index);
            StopVoice();
            Advance();
        }

        void Advance()
        {
            SyncFromAuthority();
            while (Story.canContinue)
            {
                NotePassage();
                var raw = Story.Continue().Trim();
                if (raw.Length == 0)
                {
                    // A tag with no text after it (a cue at the end of a passage) still reaches the game.
                    foreach (var t in Story.currentTags)
                        if (!IsStoryTag(t)) { TagFound?.Invoke(t); onTag.Invoke(t); }
                    continue;
                }
                var line = ParseLine(raw, new List<string>(Story.currentTags));
                transcript.Add(line);
                QueueVoice(line);
                LineShown?.Invoke(line);
                onLine.Invoke(line.Speaker ?? "", line.Text);
                foreach (var t in line.Tags)
                    if (!IsStoryTag(t)) { TagFound?.Invoke(t); onTag.Invoke(t); }
            }
            AutosaveIfNewPassage();
            if (IsAtExit) { ExitReached?.Invoke(CurrentExit); onExit.Invoke(CurrentExit); }
            else if (IsWaitingForContinue) { ContinueShown?.Invoke(); onContinue.Invoke(); }
            else if (Story.currentChoices.Count > 0) { ChoicesShown?.Invoke(Story.currentChoices); onChoices.Invoke(); }
            else
            {
                HasEnded = true;
                StoryEnded?.Invoke();
                onEnded.Invoke();
            }
        }

        // An autosave each time the reader reaches a new passage (only while the game plays).
        void AutosaveIfNewPassage()
        {
            if (!autosave || !Application.isPlaying || silent || Story == null) return;
            var passage = CurrentPassage;
            if (passage == null || passage == autosavedPassage) return;
            autosavedPassage = passage;
            SaveToSlot(AutosaveSlot);
        }

        static bool IsStoryTag(string t) =>
            t == "transition" || t == "cutscene" || t.StartsWith("speaker:") || t.StartsWith("scene:") || t.StartsWith("paren:") || t.StartsWith("ext:") || t.StartsWith("image:") || t.StartsWith("audio:");

        // ---- Voice clips: lines tagged #audio:<file> play in order --------------------------

        void QueueVoice(Line line)
        {
            if (!playVoiceClips || voice == null) return;
            foreach (var t in line.Tags)
            {
                if (!t.StartsWith("audio:")) continue;
                var item = new VoiceItem { Loading = true };
                voiceQueue.Enqueue(item);
                LoadVoiceClipAsync(t.Substring(6).Trim(), clip => { item.Clip = clip; item.Loading = false; });
            }
        }

        void StopVoice()
        {
            voiceQueue.Clear();
            if (voice != null) voice.Stop();
        }

        void Update()
        {
            // The next clip plays when the last has finished (and once it has loaded).
            while (voice != null && !voice.isPlaying && voiceQueue.Count > 0 && !voiceQueue.Peek().Loading)
            {
                var next = voiceQueue.Dequeue();
                if (next.Clip == null) continue;
                voice.clip = next.Clip;
                voice.volume = voiceVolume;
                voice.Play();
            }
        }

        static Line ParseLine(string raw, List<string> tags)
        {
            string speaker = null, speakerId = null, scene = null, paren = null, image = null;
            var transition = false;
            var cutscene = false;
            foreach (var t in tags)
            {
                if (t.StartsWith("speaker:")) speaker = speakerId = t.Substring(8).Trim();
                else if (t.StartsWith("scene:")) scene = t.Substring(6).Trim();
                else if (t.StartsWith("paren:")) paren = t.Substring(6).Trim();
                else if (t.StartsWith("image:")) image = t.Substring(6).Trim();
                else if (t == "transition") transition = true;
                else if (t == "cutscene") cutscene = true;
            }
            var text = raw;
            if (speaker != null)
            {
                var colon = raw.IndexOf(": ", StringComparison.Ordinal);
                if (colon > 0) { speaker = raw.Substring(0, colon); text = raw.Substring(colon + 2); }
            }
            return Localize(new Line { Speaker = speaker, SpeakerId = speakerId, Text = text, Tags = tags, Scene = scene, Paren = paren, Image = image, IsTransition = transition, IsCutscene = cutscene, SourceText = text, SourceSpeaker = speaker, SourceScene = scene, SourceParen = paren });
        }

        // ---- Scene pictures: the first line of a scene may carry #image:<file> ----------------

        static readonly Dictionary<string, Texture2D> pictures = new Dictionary<string, Texture2D>();
        static readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();

        // ---- Loading voice clips and pictures: from Resources, or on demand with Addressables ------

        /// <summary>
        /// The picture for an #image file name, or null. Pictures ship as their PNG or JPEG bytes (StoryInfo.ImageFolder +
        /// file + ".bytes" in Resources, or AddressPrefix + "Images/" + file with Addressables) and are decoded once, then
        /// kept. With Addressables this waits for the load; LoadPictureAsync doesn't (needed on WebGL).
        /// </summary>
        public static Texture2D LoadPicture(string file)
        {
            if (string.IsNullOrEmpty(file)) return null;
            if (pictures.TryGetValue(file, out var cached) && cached != null) return cached;
            if (!StoryInfo.UsesAddressables) return Decode(file, Resources.Load<TextAsset>(StoryInfo.ImageFolder + file), true);
#if UNITY_EDITOR
            // Outside Play mode Addressables has no content to load from: read the package's file itself.
            if (!Application.isPlaying) return Decode(file, UnityEditor.AssetDatabase.LoadAssetAtPath<TextAsset>(StoryInfo.StoryAssetsFolder + "Images/" + file + ".bytes"), false);
#endif
#if NARRATIVE_BRIDGE_ADDRESSABLES
            var handle = Addressables.LoadAssetAsync<TextAsset>(StoryInfo.AddressPrefix + "Images/" + file);
            var data = handle.WaitForCompletion();
            var texture = Decode(file, handle.Status == AsyncOperationStatus.Succeeded ? data : null, false);
            Addressables.Release(handle);
            return texture;
#else
            NoAddressables();
            return null;
#endif
        }

        /// <summary>Loads a picture without waiting, then calls done with it (or null). At once when it's already loaded.</summary>
        public static void LoadPictureAsync(string file, Action<Texture2D> done)
        {
            if (string.IsNullOrEmpty(file)) { done(null); return; }
            if ((pictures.TryGetValue(file, out var cached) && cached != null) || !StoryInfo.UsesAddressables || !Application.isPlaying) { done(LoadPicture(file)); return; }
#if NARRATIVE_BRIDGE_ADDRESSABLES
            var handle = Addressables.LoadAssetAsync<TextAsset>(StoryInfo.AddressPrefix + "Images/" + file);
            handle.Completed += op =>
            {
                var texture = pictures.TryGetValue(file, out var c) && c != null ? c : Decode(file, op.Status == AsyncOperationStatus.Succeeded ? op.Result : null, false);
                Addressables.Release(op);
                done(texture);
            };
#else
            NoAddressables();
            done(null);
#endif
        }

        static Texture2D Decode(string file, TextAsset data, bool fromResources)
        {
            if (data == null) return null;
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false) { name = file, wrapMode = TextureWrapMode.Clamp };
            // Keep no CPU copy once it's on the GPU (there is no GPU when the editor runs headless).
            var ok = texture.LoadImage(data.bytes, SystemInfo.graphicsDeviceType != UnityEngine.Rendering.GraphicsDeviceType.Null);
            if (fromResources) Resources.UnloadAsset(data);
            if (!ok) return null;
            pictures[file] = texture;
            return texture;
        }

        static string ClipName(string file)
        {
            var dot = file.LastIndexOf('.');
            return dot > 0 ? file.Substring(0, dot) : file;
        }

        /// <summary>A voice clip by its #audio file name, or null. With Addressables this waits for the load.</summary>
        public static AudioClip LoadVoiceClip(string file)
        {
            var name = ClipName(file);
            if (clips.TryGetValue(name, out var cached) && cached != null) return cached;
            AudioClip clip = null;
            if (!StoryInfo.UsesAddressables) clip = Resources.Load<AudioClip>(StoryInfo.AudioFolder + name);
#if UNITY_EDITOR
            else if (!Application.isPlaying)
            {
                // Outside Play mode Addressables has no content to load from: find the package's clip itself.
                foreach (var guid in UnityEditor.AssetDatabase.FindAssets(name + " t:AudioClip", new[] { StoryInfo.StoryAssetsFolder + "Audio" }))
                {
                    var path = UnityEditor.AssetDatabase.GUIDToAssetPath(guid);
                    if (System.IO.Path.GetFileNameWithoutExtension(path) == name) { clip = UnityEditor.AssetDatabase.LoadAssetAtPath<AudioClip>(path); break; }
                }
            }
#endif
            else
            {
#if NARRATIVE_BRIDGE_ADDRESSABLES
                var handle = Addressables.LoadAssetAsync<AudioClip>(StoryInfo.AddressPrefix + "Audio/" + name);
                clip = handle.WaitForCompletion();
                if (handle.Status != AsyncOperationStatus.Succeeded) clip = null;
                else loadedClips.Add(handle);
#else
                NoAddressables();
#endif
            }
            if (clip != null) clips[name] = clip;
            return clip;
        }

        /// <summary>Loads a voice clip without waiting, then calls done with it (or null). At once when it's already loaded.</summary>
        public static void LoadVoiceClipAsync(string file, Action<AudioClip> done)
        {
            var name = ClipName(file);
            if ((clips.TryGetValue(name, out var cached) && cached != null) || !StoryInfo.UsesAddressables || !Application.isPlaying)
            {
                var clip = LoadVoiceClip(file);
                if (clip == null) Debug.LogWarning("[NarrativeBridge] Voice clip not found: " + file);
                done(clip);
                return;
            }
#if NARRATIVE_BRIDGE_ADDRESSABLES
            var handle = Addressables.LoadAssetAsync<AudioClip>(StoryInfo.AddressPrefix + "Audio/" + name);
            handle.Completed += op =>
            {
                AudioClip clip = null;
                if (op.Status == AsyncOperationStatus.Succeeded) { clip = op.Result; clips[name] = clip; loadedClips.Add(op); }
                else Debug.LogWarning("[NarrativeBridge] Voice clip not found in Addressables: " + StoryInfo.AddressPrefix + "Audio/" + name);
                done(clip);
            };
#else
            NoAddressables();
            done(null);
#endif
        }

#if NARRATIVE_BRIDGE_ADDRESSABLES
        static readonly List<AsyncOperationHandle<AudioClip>> loadedClips = new List<AsyncOperationHandle<AudioClip>>();
#endif

        /// <summary>Lets go of every voice clip and picture loaded so far (they load again when needed), e.g. between chapters.</summary>
        public static void ReleaseLoadedMedia()
        {
            foreach (var t in pictures.Values)
            {
                if (t == null) continue;
                if (Application.isPlaying) UnityEngine.Object.Destroy(t);
                else UnityEngine.Object.DestroyImmediate(t);
            }
            pictures.Clear();
            clips.Clear();
#if NARRATIVE_BRIDGE_ADDRESSABLES
            foreach (var h in loadedClips) if (h.IsValid()) Addressables.Release(h);
            loadedClips.Clear();
#endif
        }

#if !NARRATIVE_BRIDGE_ADDRESSABLES
        static bool warnedAddressables;
        static void NoAddressables()
        {
            if (warnedAddressables) return;
            warnedAddressables = true;
            Debug.LogError("[NarrativeBridge] This story loads its voice clips and pictures with Addressables, but the Addressables package (com.unity.addressables) isn't installed.");
        }
#endif

        /// <summary>A character's portrait file name (in StoryInfo.ImageFolder), by speaker id, or null.</summary>
        public static string PortraitFile(string speakerId)
        {
            var i = speakerId == null ? -1 : Array.IndexOf(StoryInfo.PortraitSpeakers, speakerId);
            return i >= 0 ? StoryInfo.PortraitFiles[i] : null;
        }

        /// <summary>A character's portrait, by speaker id (Line.SpeakerId), or null if they have none.</summary>
        public static Texture2D LoadPortrait(string speakerId) => LoadPicture(PortraitFile(speakerId));

        /// <summary>The picture of the scene the reader is in: the latest #image in the transcript, or null.</summary>
        public string CurrentPicture
        {
            get
            {
                for (int i = transcript.Count - 1; i >= 0; i--) if (transcript[i].Image != null) return transcript[i].Image;
                return null;
            }
        }

        // ---- Variables -------------------------------------------------------------------

        public object GetVariable(string name)
        {
            if (Array.IndexOf(StoryInfo.Variables, name) < 0 && Array.IndexOf(StoryInfo.ItemVariables, name) < 0)
                throw new ArgumentException("Not an approved story variable: " + name);
            return Story.variablesState[name];
        }

        public void SetVariable(string name, object value)
        {
            if (Array.IndexOf(StoryInfo.Variables, name) < 0)
                throw new ArgumentException("Not a writable story variable: " + name);
            Story.variablesState[name] = value;
        }

        void OnVariableObserved(string name, object value)
        {
            if (Array.IndexOf(StoryInfo.ItemVariables, name) >= 0) OnItemVariableChanged(name, value);
            if (silent) return;
            VariableChanged?.Invoke(name, value);
            onVariableChanged.Invoke(name, value == null ? "" : value.ToString());
        }

        /// <summary>Tells listeners the value of every variable, e.g. after a load.</summary>
        void RaiseAllVariables()
        {
            if (Story == null) return;
            foreach (var v in StoryInfo.ItemVariables) OnVariableObserved(v, Story.variablesState[v]);
            foreach (var v in StoryInfo.Variables) OnVariableObserved(v, Story.variablesState[v]);
        }

        // ---- Inventory synchronisation: the host game is the single source of truth -------

        void SyncFromAuthority()
        {
            if (authority == null || Story == null) return;
            syncing = true;
            foreach (var v in StoryInfo.ItemVariables)
                Story.variablesState[v] = authority.HasItem(v.Substring(4));
            syncing = false;
        }

        void OnItemVariableChanged(string variableName, object newValue)
        {
            if (syncing || authority == null) return;
            var itemId = variableName.Substring(4);
            if (newValue is bool has)
            {
                if (has) authority.GiveItem(itemId);
                else authority.TakeItem(itemId);
            }
        }

        // ---- Save / load with story-version checks ----------------------------------------

        /// <summary>Saves to PlayerPrefs (one slot per story), as the demo's Save button does.</summary>
        public void SaveToPrefs()
        {
            if (Story == null) return;
            PlayerPrefs.SetString(SaveKey, SaveState());
            SetStatus("Saved.");
        }

        /// <summary>Loads the PlayerPrefs slot, as the demo's Load button does. The outcome is in Status.</summary>
        public void LoadFromPrefs()
        {
            if (Story == null) return;
            SetStatus(TryLoadState(PlayerPrefs.GetString(SaveKey, ""), out var err) ? LoadNote ?? "Loaded." : err);
        }

        // ---- Save slots: several saves and an autosave, through ISaveStorage --------------------

        /// <summary>The autosave's slot number; the player's slots are 1 to saveSlots.</summary>
        public const int AutosaveSlot = 0;

        /// <summary>What a save slot holds: when it was saved, where, and the last line read.</summary>
        public struct SlotInfo
        {
            public int Slot;
            public bool Exists;
            public DateTime SavedAt;
            public string Passage;
            public string PassageTitle;
            public string Excerpt;
            /// <summary>The save is from an earlier version of the story (it loads by replaying its choices).</summary>
            public bool OtherVersion;
        }

        /// <summary>Where slots are kept: Save Storage when set, else files (see FileSaveStorage). Settable from code.</summary>
        public ISaveStorage Storage
        {
            get
            {
                if (storage == null) storage = saveStorage as ISaveStorage ?? new FileSaveStorage();
                return storage;
            }
            set => storage = value;
        }

        /// <summary>Raised after a slot is saved (its number; AutosaveSlot for the autosave).</summary>
        public event Action<int> Saved;

        ISaveStorage storage;
        string autosavedPassage;

        static string SlotKey(int slot) => slot == AutosaveSlot ? "autosave" : "slot-" + slot;

        public SlotInfo GetSlot(int slot)
        {
            var info = new SlotInfo { Slot = slot };
            string json = null;
            try { json = Storage.Read(SlotKey(slot)); } catch (Exception e) { Debug.LogWarning("[NarrativeBridge] Could not read save slot " + slot + ": " + e.Message); }
            if (string.IsNullOrEmpty(json)) return info;
            SaveData data = null;
            try { data = JsonUtility.FromJson<SaveData>(json); } catch { }
            if (data == null || string.IsNullOrEmpty(data.inkState)) return info;
            info.Exists = true;
            DateTime.TryParse(data.savedAt, null, System.Globalization.DateTimeStyles.RoundtripKind, out info.SavedAt);
            info.Passage = data.passage;
            var i = string.IsNullOrEmpty(data.passage) ? -1 : Array.IndexOf(StoryInfo.Passages, data.passage);
            info.PassageTitle = i >= 0 ? StoryInfo.PassageTitles[i] : data.passage;
            info.Excerpt = data.excerpt;
            info.OtherVersion = data.storyVersion != StoryInfo.StoryVersion;
            return info;
        }

        /// <summary>The autosave and every player slot, in order (slot 0 is the autosave).</summary>
        public List<SlotInfo> GetSlots()
        {
            var list = new List<SlotInfo>();
            for (int i = 0; i <= saveSlots; i++) list.Add(GetSlot(i));
            return list;
        }

        public void SaveToSlot(int slot)
        {
            if (Story == null) return;
            try
            {
                Storage.Write(SlotKey(slot), SaveState());
                if (slot != AutosaveSlot) SetStatus("Saved to slot " + slot + ".");
                Saved?.Invoke(slot);
            }
            catch (Exception e) { ReportError("Could not save: " + e.Message); }
        }

        /// <summary>Loads a slot; false (with the reason in Status) when it's empty or can't be loaded.</summary>
        public bool LoadFromSlot(int slot)
        {
            string json = null;
            try { json = Storage.Read(SlotKey(slot)); } catch (Exception e) { SetStatus("Could not read the save: " + e.Message); return false; }
            if (string.IsNullOrEmpty(json)) { SetStatus("That slot is empty."); return false; }
            var ok = TryLoadState(json, out var err);
            SetStatus(ok ? LoadNote ?? (slot == AutosaveSlot ? "Loaded the autosave." : "Loaded slot " + slot + ".") : err);
            autosavedPassage = CurrentPassage;
            return ok;
        }

        public void DeleteSlot(int slot)
        {
            try { Storage.Delete(SlotKey(slot)); } catch (Exception e) { Debug.LogWarning("[NarrativeBridge] Could not delete save slot " + slot + ": " + e.Message); }
        }

        string Excerpt()
        {
            for (int i = transcript.Count - 1; i >= 0; i--)
            {
                if (transcript[i].IsChoice || string.IsNullOrEmpty(transcript[i].Text)) continue;
                var t = (transcript[i].Speaker != null ? transcript[i].Speaker + ": " : "") + transcript[i].Text;
                return t.Length > 90 ? t.Substring(0, 87) + "..." : t;
            }
            return "";
        }

        /// <summary>The story's state as a string, to keep in your own save system.</summary>
        public string SaveState()
        {
            return JsonUtility.ToJson(new SaveData
            {
                storyVersion = StoryInfo.StoryVersion,
                inkState = Story.state.ToJson(),
                choicePath = new List<string>(choicePath),
                startPassage = StartPassage ?? "",
                savedAt = DateTime.UtcNow.ToString("o"),
                passage = CurrentPassage ?? "",
                excerpt = Excerpt(),
            });
        }

        public bool TryLoadState(string saveJson, out string error)
        {
            error = null;
            LoadNote = null;
            SaveData data = null;
            try { data = JsonUtility.FromJson<SaveData>(saveJson); } catch (Exception e) { error = "Save data is corrupt: " + e.Message; return false; }
            if (data == null || string.IsNullOrEmpty(data.inkState)) { error = "Save data is empty."; return false; }
            if (Story == null) StartStory();
            if (Story == null) { error = "The story could not start."; return false; }
            StartPassage = string.IsNullOrEmpty(data.startPassage) ? null : data.startPassage;
            if (data.storyVersion != StoryInfo.StoryVersion)
            {
                // Saves from before choices were recorded can't be carried over (JsonUtility turns a
                // missing list into an empty one, so look for the field itself).
                if (data.choicePath == null || saveJson.IndexOf("\\"choicePath\\"", StringComparison.Ordinal) < 0)
                {
                    error = "This save was made with story version " + data.storyVersion + " but the game now has " + StoryInfo.StoryVersion + ". Restart the narrative.";
                    return false;
                }
                ReplayChoices(data.choicePath, data.storyVersion);
                return true;
            }
            Story.state.LoadJson(data.inkState);
            choicePath.Clear();
            if (data.choicePath != null) choicePath.AddRange(data.choicePath);
            transcript.Clear();
            HasEnded = false;
            Restarted?.Invoke();
            RaiseAllVariables();
            if (Story.canContinue) Advance();
            else if (IsAtExit) { ExitReached?.Invoke(CurrentExit); onExit.Invoke(CurrentExit); }
            else if (IsWaitingForContinue) { ContinueShown?.Invoke(); onContinue.Invoke(); }
            else if (Story.currentChoices.Count > 0) { ChoicesShown?.Invoke(Story.currentChoices); onChoices.Invoke(); }
            return true;
        }

        // A save from another version of the story: play the new version from the start (or the passage
        // it was started at), silently, making the same choices (matched by their text), so its text and
        // variables apply. Stops at the first choice the new version no longer offers.
        void ReplayChoices(List<string> path, string savedVersion)
        {
            Story.ResetState();
            if (StartPassage != null && Array.IndexOf(StoryInfo.Passages, StartPassage) >= 0) Story.ChoosePathString(StartPassage);
            choicePath.Clear();
            transcript.Clear();
            HasEnded = false;
            StopVoice();
            var followed = 0;
            syncing = true; // the host's inventory is already where the save left it
            silent = true;
            try
            {
                // Continue breaks added or removed since the save don't stop it: take or skip them.
                for (int i = 0, steps = 0; i < path.Count && steps < 10000; steps++)
                {
                    var before = Story.state.ToJson();
                    while (Story.canContinue) Story.Continue();
                    if (path[i].StartsWith(JumpMark, StringComparison.Ordinal))
                    {
                        // A jump the game made with ResumeAt.
                        var target = path[i].Substring(JumpMark.Length);
                        if (Array.IndexOf(StoryInfo.Passages, target) < 0) break;
                        Story.ChoosePathString(target);
                        choicePath.Add(path[i]);
                        followed++;
                        i++;
                        continue;
                    }
                    var match = Story.currentChoices.Find(c => c.text == path[i]);
                    if (match != null)
                    {
                        Story.ChooseChoiceIndex(match.index);
                        choicePath.Add(path[i]);
                        followed++;
                        i++;
                    }
                    else if (IsWaitingForContinue)
                    {
                        Story.ChooseChoiceIndex(0);
                        choicePath.Add(ContinueText);
                    }
                    else if (path[i] == ContinueText)
                    {
                        followed++;
                        i++;
                    }
                    else { Story.state.LoadJson(before); break; }
                }
            }
            finally { syncing = false; silent = false; }
            Restarted?.Invoke();
            RaiseAllVariables();
            LoadNote = followed == path.Count
                ? "Carried this save over from story version " + savedVersion + ": all " + path.Count + " choices replayed."
                : "Carried this save over from story version " + savedVersion + ": " + followed + " of " + path.Count + " choices still exist, so it resumes after the last one that does.";
            Advance();
        }

        void ReportError(string message)
        {
            Debug.LogError("[NarrativeBridge] " + message, this);
            SetStatus(message);
            RuntimeError?.Invoke(message);
        }

        void SetStatus(string message)
        {
            status = message ?? "";
            StatusChanged?.Invoke(status);
        }

        // ---- Demo UI ---------------------------------------------------------------------

        void OnGUI()
        {
            if (!drawDemoUI) return;
            var w = Mathf.Min(720, Screen.width - 40);
            GUILayout.BeginArea(new Rect((Screen.width - w) / 2, 20, w, Screen.height - 40));
            GUILayout.Label("<size=20><b>" + StoryInfo.Title + "</b></size>", new GUIStyle(GUI.skin.label) { richText = true });
            scroll = GUILayout.BeginScrollView(scroll, GUILayout.ExpandHeight(true));
            var style = new GUIStyle(GUI.skin.label) { richText = true, wordWrap = true, fontSize = 15 };
            foreach (var l in transcript)
            {
                if (l.IsChoice) GUILayout.Label("<i>> " + l.Text + "</i>", style);
                else if (l.Speaker != null) GUILayout.Label("<b>" + l.Speaker + "</b>  " + l.Text, style);
                else GUILayout.Label(l.Text, style);
            }
            GUILayout.EndScrollView();
            if (Story != null)
            {
                for (int i = 0; i < Story.currentChoices.Count; i++)
                    if (GUILayout.Button(Story.currentChoices[i].text, GUILayout.Height(32))) { Choose(i); scroll.y = float.MaxValue; }
                if (HasEnded) GUILayout.Label("<b>— The End —</b>", style);
            }
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Restart")) StartStory();
            if (Story != null && GUILayout.Button("Save")) SaveToPrefs();
            if (Story != null && GUILayout.Button("Load")) LoadFromPrefs();
            GUILayout.EndHorizontal();
            if (!string.IsNullOrEmpty(status)) GUILayout.Label(status);
            GUILayout.EndArea();
        }
    }
}
`;

const DEBUGGER_CS = `using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace __NAMESPACE__.EditorTools
{
    /// <summary>
    /// Tools → Narrative Bridge → __MENU_TITLE__ → Story Debugger. While the game plays it follows the story: the
    /// passage the reader is in, the choices (click to choose), the locked ones, every story variable and item (edit
    /// them), a jump to any passage, and saves to and from the clipboard.
    /// </summary>
    public class StoryDebuggerWindow : EditorWindow
    {
        NarrativeController target;
        Vector2 scroll;
        int jumpIndex;
        bool showVariables = true, showItems = true, showTranscript = true;

        [MenuItem("Tools/Narrative Bridge/__MENU_TITLE__/Story Debugger")]
        public static void Open() => GetWindow<StoryDebuggerWindow>(false, "Story Debugger", true);

        void OnEnable() => EditorApplication.playModeStateChanged += OnPlayModeChanged;
        void OnDisable() => EditorApplication.playModeStateChanged -= OnPlayModeChanged;
        void OnPlayModeChanged(PlayModeStateChange change) { target = null; Repaint(); }
        void OnInspectorUpdate() { if (Application.isPlaying) Repaint(); }

        void OnGUI()
        {
            EditorGUILayout.LabelField(StoryInfo.Title, EditorStyles.boldLabel);
            if (!Application.isPlaying)
            {
                EditorGUILayout.HelpBox("Press Play to follow the story here: the passage, the choices (click one to choose it), the locked ones, and the story's variables and items, which you can change.", MessageType.Info);
                return;
            }
            var all = UnityEngine.Object.FindObjectsByType<NarrativeController>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            if (all.Length == 0)
            {
                EditorGUILayout.HelpBox("No NarrativeController for this story is in the open scenes.", MessageType.Warning);
                return;
            }
            if (target == null || Array.IndexOf(all, target) < 0) target = all[0];
            if (all.Length > 1)
            {
                var names = Array.ConvertAll(all, x => x.gameObject.name);
                target = all[EditorGUILayout.Popup("Controller", Array.IndexOf(all, target), names)];
            }
            var c = target;
            scroll = EditorGUILayout.BeginScrollView(scroll);
            try { Draw(c); }
            finally { EditorGUILayout.EndScrollView(); }
        }

        void Draw(NarrativeController c)
        {
            if (c.Story == null)
            {
                EditorGUILayout.HelpBox("The story hasn't started.", MessageType.Info);
                if (GUILayout.Button("Start the story")) c.StartStory();
                DrawJump(c);
                return;
            }
            EditorGUILayout.LabelField("Passage", c.CurrentPassage ?? "(none yet)");
            EditorGUILayout.LabelField("Waiting for", c.HasEnded ? "nothing: the story has ended" : c.IsAtExit ? "the game (exit: " + c.CurrentExit + ")" : c.IsWaitingForContinue ? "Continue" : c.Story.currentChoices.Count + " choice(s)");
            if (!string.IsNullOrEmpty(c.Status)) EditorGUILayout.LabelField("Status", c.Status);

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Choices", EditorStyles.boldLabel);
            if (c.IsAtExit)
            {
                if (GUILayout.Button("Resume the story (as the game would)")) c.Resume();
            }
            else if (c.IsWaitingForContinue)
            {
                if (GUILayout.Button("Continue")) c.Continue();
            }
            else
            {
                var choices = c.Story.currentChoices;
                for (int i = 0; i < choices.Count; i++)
                    if (GUILayout.Button((i + 1) + ". " + choices[i].text, EditorStyles.miniButton)) { c.Choose(i); GUIUtility.ExitGUI(); }
                using (new EditorGUI.DisabledScope(true))
                    foreach (var l in c.LockedChoices) GUILayout.Button("Locked: " + l.Text + "  (needs " + l.Needs + ")", EditorStyles.miniButton);
                if (c.HasEnded) EditorGUILayout.LabelField("The story has ended.");
            }
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Restart")) c.StartStory();
                if (GUILayout.Button("Copy save")) { EditorGUIUtility.systemCopyBuffer = c.SaveState(); ShowNotification(new GUIContent("Save copied")); }
                if (GUILayout.Button("Load save from clipboard"))
                    ShowNotification(new GUIContent(c.TryLoadState(EditorGUIUtility.systemCopyBuffer, out var err) ? (c.LoadNote ?? "Loaded") : err));
            }
            DrawJump(c);

            EditorGUILayout.Space();
            showVariables = EditorGUILayout.Foldout(showVariables, "Variables (" + StoryInfo.Variables.Length + ")", true);
            if (showVariables) foreach (var name in StoryInfo.Variables) DrawVariable(c, name, name);
            showItems = EditorGUILayout.Foldout(showItems, "Items (" + StoryInfo.ItemVariables.Length + ")", true);
            if (showItems)
            {
                if (c.inventoryAuthority != null && StoryInfo.ItemVariables.Length > 0)
                    EditorGUILayout.HelpBox("Your game's inventory decides the items: changes here are passed to it.", MessageType.None);
                foreach (var name in StoryInfo.ItemVariables) DrawVariable(c, name, name.Substring(4));
            }

            EditorGUILayout.Space();
            showTranscript = EditorGUILayout.Foldout(showTranscript, "Latest lines", true);
            if (showTranscript)
            {
                var t = c.Transcript;
                for (int i = Mathf.Max(0, t.Count - 12); i < t.Count; i++)
                    EditorGUILayout.LabelField(t[i].IsChoice ? "> " + t[i].Text : (t[i].Speaker != null ? t[i].Speaker + ": " : "") + t[i].Text, EditorStyles.wordWrappedMiniLabel);
            }
        }

        void DrawJump(NarrativeController c)
        {
            if (StoryInfo.Passages.Length == 0) return;
            using (new EditorGUILayout.HorizontalScope())
            {
                jumpIndex = EditorGUILayout.Popup("Jump to", Mathf.Clamp(jumpIndex, 0, StoryInfo.Passages.Length - 1), StoryInfo.Passages);
                if (GUILayout.Button("Go", GUILayout.Width(40)))
                {
                    if (c.Story == null) c.StartAt(StoryInfo.Passages[jumpIndex]);
                    else c.ResumeAt(StoryInfo.Passages[jumpIndex]);
                }
            }
        }

        static void DrawVariable(NarrativeController c, string name, string label)
        {
            object value;
            try { value = c.Story.variablesState[name]; } catch { return; }
            object changed = value;
            if (value is bool b) changed = EditorGUILayout.Toggle(label, b);
            else if (value is int i) changed = EditorGUILayout.IntField(label, i);
            else if (value is float f) changed = EditorGUILayout.FloatField(label, f);
            else if (value is string s) changed = EditorGUILayout.TextField(label, s);
            else EditorGUILayout.LabelField(label, value == null ? "(none)" : value.ToString());
            if (!Equals(changed, value)) c.Story.variablesState[name] = changed;
        }
    }
}
`;

const ROUTES_RUNNER_CS = `using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace __NAMESPACE__.EditorTools
{
    /// <summary>
    /// Replays the story's playthrough routes (StoryRoutes) on a NarrativeController: each must offer the same
    /// choices, reach the same ending and finish on the same line as when it was exported. Run them with
    /// Tools → Narrative Bridge → __MENU_TITLE__ → Run Playthrough Tests, the Test Runner (the package's tests), or
    /// headless: -executeMethod __NAMESPACE__.EditorTools.PlaythroughRunner.RunBatch
    /// </summary>
    public static class PlaythroughRunner
    {
        /// <summary>Replays one route; null when it plays as written, else what was different.</summary>
        public static string Run(StoryRoutes.Route route)
        {
            var go = new GameObject("NarrativeBridge playthrough");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                c.drawDemoUI = false;
                c.autosave = false;
                string error = null;
                c.RuntimeError += m => { if (error == null) error = m; };
                c.StartStory();
                if (c.Story == null) return "The story did not start" + (error != null ? ": " + error : ".");
                for (int i = 0; i < route.Choices.Length; i++)
                {
                    var want = route.Choices[i];
                    var index = c.Story.currentChoices.FindIndex(x => x.text == want);
                    if (index < 0) return "Step " + (i + 1) + " (in " + (c.CurrentPassage ?? "?") + "): expected the choice \\"" + want + "\\" but the story offers " + Offered(c) + ".";
                    c.Choose(index);
                    if (error != null) return "Step " + (i + 1) + ": " + error;
                }
                if (!c.HasEnded) return "Expected the story to end after " + route.Choices.Length + " choice(s), but it offers " + Offered(c) + ".";
                if (!string.IsNullOrEmpty(route.Ending) && c.Story.state.VisitCountAtPathString(route.Ending) <= 0) return "Expected to end in " + route.Ending + ", but the story never got there.";
                var last = LastLine(c);
                if (last != route.LastLine) return "Expected the last line \\"" + route.LastLine + "\\" but it was \\"" + last + "\\".";
                return error;
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        static string Offered(NarrativeController c)
        {
            if (c.Story.currentChoices.Count == 0) return "no choices";
            return "[" + string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text)) + "]";
        }

        static string LastLine(NarrativeController c)
        {
            for (int i = c.Transcript.Count - 1; i >= 0; i--)
            {
                var l = c.Transcript[i];
                if (!l.IsChoice) return (l.Speaker != null ? l.Speaker + ": " : "") + l.Text;
            }
            return "";
        }

        /// <summary>Replays every route; the log lists each one and what went wrong.</summary>
        public static bool RunAll(out string log)
        {
            var lines = new List<string>();
            var failed = 0;
            foreach (var route in StoryRoutes.All)
            {
                var problem = Run(route);
                if (problem != null) failed++;
                lines.Add((problem == null ? "  passed  " : "  FAILED  ") + route.Name + (problem == null ? "" : ": " + problem));
            }
            log = "[NarrativeBridge] Playthrough tests: " + (StoryRoutes.All.Length - failed) + " of " + StoryRoutes.All.Length + " routes play as written." + "\\n" + string.Join("\\n", lines);
            return failed == 0;
        }

        [MenuItem("Tools/Narrative Bridge/__MENU_TITLE__/Run Playthrough Tests")]
        static void RunMenu()
        {
            var ok = RunAll(out var log);
            if (ok) Debug.Log(log); else Debug.LogError(log);
        }

        /// <summary>Headless: Unity -batchmode -projectPath . -executeMethod __NAMESPACE__.EditorTools.PlaythroughRunner.RunBatch (exit code 0 = all passed).</summary>
        public static void RunBatch()
        {
            var ok = RunAll(out var log);
            Debug.Log(log);
            EditorApplication.Exit(ok ? 0 : 1);
        }
    }
}
`;

const ROUTE_TESTS_CS = `using System.Collections.Generic;
using NUnit.Framework;
using __NAMESPACE__.EditorTools;

namespace __NAMESPACE__.Tests
{
    /// <summary>
    /// The story's playthrough routes as Test Runner tests (Window → General → Test Runner → Edit Mode). Each one
    /// replays a route through NarrativeController and checks the story still plays as it did when exported.
    /// A package's tests show in the Test Runner when the project lists it under "testables" in Packages/manifest.json.
    /// </summary>
    public class PlaythroughTests
    {
        static IEnumerable<TestCaseData> Routes()
        {
            for (int i = 0; i < StoryRoutes.All.Length; i++)
                yield return new TestCaseData(i).SetName("Route " + (i + 1).ToString("00") + " - " + StoryRoutes.All[i].Name.Replace("(", "[").Replace(")", "]").Replace(",", " "));
        }

        [TestCaseSource(nameof(Routes))]
        public void PlaysAsWritten(int route)
        {
            var problem = PlaythroughRunner.Run(StoryRoutes.All[route]);
            Assert.IsNull(problem, problem);
        }

        [Test]
        public void HasRoutes() => Assert.Greater(StoryRoutes.All.Length, 0, "The export found no playthrough routes.");
    }
}
`;

const ADDRESSABLES_SETUP_CS = `#if NARRATIVE_BRIDGE_ADDRESSABLES
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.AddressableAssets;
using UnityEditor.AddressableAssets.Settings;
using UnityEditor.AddressableAssets.Settings.GroupSchemas;
using UnityEngine;

namespace __NAMESPACE__.EditorTools
{
    /// <summary>
    /// When the story loads its voice clips and pictures with Addressables (StoryInfo.UsesAddressables), puts them in an
    /// Addressables group, "__MENU_TITLE__ Story", with the addresses the controller asks for. It runs by itself when the
    /// group is missing; Tools → Narrative Bridge → __MENU_TITLE__ → Set Up Addressables runs it again (after an update).
    /// </summary>
    [InitializeOnLoad]
    public static class AddressablesSetup
    {
        public const string GroupName = "__MENU_TITLE__ Story";
        const string Folder = "Packages/__PACKAGE__/Runtime/StoryAssets";

        static AddressablesSetup()
        {
            if (!StoryInfo.UsesAddressables) return;
            EditorApplication.delayCall += () =>
            {
                var settings = AddressableAssetSettingsDefaultObject.Settings;
                if (settings == null || settings.FindGroup(GroupName) == null) SetUp();
            };
        }

        [MenuItem("Tools/Narrative Bridge/__MENU_TITLE__/Set Up Addressables")]
        static void SetUpMenu()
        {
            if (!StoryInfo.UsesAddressables) { Debug.Log("[NarrativeBridge] This story keeps its voice clips and pictures in Resources; export it with Addressables to load them on demand."); return; }
            Debug.Log("[NarrativeBridge] " + SetUp() + " voice clip(s) and picture(s) are in the Addressables group " + GroupName + ".");
        }

        /// <summary>Adds every voice clip and picture to the group with its address; returns how many.</summary>
        public static int SetUp()
        {
            var settings = AddressableAssetSettingsDefaultObject.GetSettings(true);
            var group = settings.FindGroup(GroupName);
            if (group == null) group = settings.CreateGroup(GroupName, false, false, false, null, typeof(BundledAssetGroupSchema), typeof(ContentUpdateGroupSchema));
            var count = 0;
            if (!AssetDatabase.IsValidFolder(Folder)) return 0;
            foreach (var guid in AssetDatabase.FindAssets("", new[] { Folder }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (AssetDatabase.IsValidFolder(path)) continue;
                var rel = path.Substring(Folder.Length + 1);
                string address;
                if (rel.StartsWith("Audio/")) address = "Audio/" + System.IO.Path.GetFileNameWithoutExtension(rel);
                else if (rel.StartsWith("Images/") && rel.EndsWith(".bytes")) address = rel.Substring(0, rel.Length - ".bytes".Length);
                else continue;
                var entry = settings.CreateOrMoveEntry(guid, group, false, false);
                entry.address = StoryInfo.AddressPrefix + address;
                count++;
            }
            settings.SetDirty(AddressableAssetSettings.ModificationEvent.BatchModification, null, true, true);
            AssetDatabase.SaveAssets();
            return count;
        }
    }
}
#endif
`;

const LOCALIZATION_TABLES_CS = `#if NARRATIVE_BRIDGE_LOCALIZATION
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Localization;
using UnityEngine;
using UnityEngine.Localization;
using UnityEngine.Localization.Settings;
using UnityEngine.Localization.Tables;

namespace __NAMESPACE__.EditorTools
{
    /// <summary>
    /// For games that use Unity's Localization package: makes (or updates) a String Table Collection from the story's
    /// translation sheet, with a locale for the story's own language and each language in the sheet. The story then
    /// follows the selected locale (NarrativeLocalization.UseUnityLocalization).
    /// </summary>
    public static class LocalizationTables
    {
        const string Folder = "__ASSET_FOLDER__/Localization";

        [MenuItem("Tools/Narrative Bridge/__MENU_TITLE__/Create Localization Tables")]
        static void CreateMenu()
        {
            var n = Create();
            Debug.Log("[NarrativeBridge] The String Table Collection " + StoryInfo.StringTableName + " has " + n + " entries, in " + (NarrativeLocalization.Languages.Count + 1) + " language(s). Translators can keep working in the sheet; run this again to bring their work in.");
        }

        /// <summary>Makes or updates the tables from the sheet (the package's, or csv); returns the number of entries.</summary>
        public static int Create(TextAsset csv = null)
        {
            EnsureFolder(Folder);
            if (LocalizationEditorSettings.ActiveLocalizationSettings == null)
            {
                var settings = ScriptableObject.CreateInstance<LocalizationSettings>();
                AssetDatabase.CreateAsset(settings, Folder + "/Localization Settings.asset");
                LocalizationEditorSettings.ActiveLocalizationSettings = settings;
            }
            var rows = NarrativeLocalization.ReadSheet(csv);
            if (rows.Count < 2) return 0;
            var header = rows[0];
            var source = System.Array.IndexOf(header, "source");
            if (source < 0) { Debug.LogWarning("[NarrativeBridge] The translation sheet has no source column."); return 0; }
            var columns = new List<KeyValuePair<string, int>> { new KeyValuePair<string, int>(StoryInfo.SourceLanguage, source) };
            for (int i = source + 1; i < header.Length; i++) if (!string.IsNullOrEmpty(header[i].Trim())) columns.Add(new KeyValuePair<string, int>(header[i].Trim(), i));
            foreach (var c in columns)
            {
                if (LocalizationEditorSettings.GetLocale(c.Key) != null) continue;
                var locale = Locale.CreateLocale(c.Key);
                AssetDatabase.CreateAsset(locale, Folder + "/" + c.Key + ".asset");
                LocalizationEditorSettings.AddLocale(locale);
            }
            var collection = LocalizationEditorSettings.GetStringTableCollection(StoryInfo.StringTableName);
            if (collection == null) collection = LocalizationEditorSettings.CreateStringTableCollection(StoryInfo.StringTableName, Folder);
            var count = 0;
            foreach (var c in columns)
            {
                var table = collection.GetTable(c.Key) as StringTable;
                if (table == null) table = collection.AddNewTable(c.Key) as StringTable;
                if (table == null) continue;
                for (int r = 1; r < rows.Count; r++)
                {
                    var row = rows[r];
                    if (row.Length <= c.Value || string.IsNullOrEmpty(row[0]) || string.IsNullOrEmpty(row[c.Value])) continue;
                    table.AddEntry(row[0], row[c.Value]);
                    if (c.Value == source) count++;
                }
                EditorUtility.SetDirty(table);
            }
            EditorUtility.SetDirty(collection);
            EditorUtility.SetDirty(collection.SharedData);
            AssetDatabase.SaveAssets();
            return count;
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var slash = path.LastIndexOf('/');
            EnsureFolder(path.Substring(0, slash));
            AssetDatabase.CreateFolder(path.Substring(0, slash), path.Substring(slash + 1));
        }
    }
}
#endif
`;

const PLAY_TESTS_CS = `using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace __NAMESPACE__.PlayTests
{
    /// <summary>
    /// Play Mode tests (Test Runner → Play Mode): the story running as it does in the game. The panel plays it to an
    /// ending through its buttons with an autosave on the way, the Settings menu redraws a live panel, the writer's cue
    /// music loads (from Resources or Addressables) and plays, and switching language translates what's on screen.
    /// </summary>
    public class StoryPlayModeTests
    {
        class MemoryStorage : ISaveStorage
        {
            public readonly Dictionary<string, string> Saves = new Dictionary<string, string>();
            public void Write(string key, string data) => Saves[key] = data;
            public string Read(string key) => Saves.TryGetValue(key, out var d) ? d : null;
            public void Delete(string key) => Saves.Remove(key);
        }

        GameObject go;

        [TearDown]
        public void TearDown()
        {
            if (go != null) Object.Destroy(go);
        }

        NarrativeView Story(out NarrativeController controller, MemoryStorage storage)
        {
            go = new GameObject("Play mode test story");
            go.SetActive(false); // set it up before Awake runs
            controller = go.AddComponent<NarrativeController>();
            controller.startOnAwake = false;
            controller.drawDemoUI = false;
            controller.Storage = storage;
            var view = go.AddComponent<NarrativeView>();
            view.controller = controller;
            var theme = NarrativeTheme.LoadExported();
            theme.charactersPerSecond = 0f; // no typewriter: the buttons are there at once
            theme.lineFade = 0f;
            theme.autoAdvance = false;
            theme.transcript = NarrativeTheme.TranscriptMode.History;
            view.theme = theme;
            go.SetActive(true);
            return view;
        }

        [UnityTest]
        public IEnumerator ThePanelPlaysTheStoryToAnEnding()
        {
            var storage = new MemoryStorage();
            var view = Story(out var c, storage);
            yield return null; // Start builds the panel
            c.StartStory();
            yield return null;
            for (int step = 0; step < 300 && !c.HasEnded; step++)
            {
                if (c.IsAtExit) c.Resume();
                else
                {
                    Assert.Greater(view.Buttons.Count, 0, "The panel shows no buttons in " + c.CurrentPassage + ".");
                    view.Buttons[0].onClick.Invoke();
                }
                yield return null;
            }
            Assert.IsTrue(c.HasEnded, "The story didn't reach an ending through the panel's buttons.");
            Assert.IsTrue(c.autosave == false || storage.Saves.ContainsKey("autosave"), "No autosave was kept while playing.");
        }

        [UnityTest]
        public IEnumerator TheSettingsMenuRedrawsALivePanel()
        {
            var view = Story(out var c, new MemoryStorage());
            if (!view.theme.showSettings || !view.theme.showToolbar) { Assert.Ignore("The theme has no Settings button."); yield break; }
            yield return null;
            c.StartStory();
            var scale = NarrativeSettings.TextScale;
            try
            {
                NarrativeSettings.TextScale = 1f;
                view.OpenSettings();
                yield return null;
                view.SettingsButtons[0].onClick.Invoke(); // text size, one step up: the panel rebuilds itself
                yield return null;
                Assert.AreEqual(1.15f, NarrativeSettings.TextScale, 0.01f);
                Assert.IsTrue(view.SettingsOpen, "The menu closed when the panel redrew.");
                var expected = c.HasEnded || c.IsAtExit ? 0 : c.IsWaitingForContinue ? 1 : c.Story.currentChoices.Count;
                Assert.AreEqual(expected, view.Buttons.Count, "The story's buttons didn't come back after the redraw.");
            }
            finally { NarrativeSettings.TextScale = scale; }
        }

        [UnityTest]
        public IEnumerator TheWritersCueMusicPlays()
        {
            string tag = null, file = null;
            for (int i = 0; i < StoryInfo.CueSoundTags.Length; i++)
            {
                var t = StoryInfo.CueSoundTags[i];
                var colon = t.IndexOf(':');
                if (NarrativeCuePlayer.Guess(colon < 0 ? t : t.Substring(0, colon)) == NarrativeCuePlayer.CueAction.PlayMusic) { tag = t; file = StoryInfo.CueSoundFiles[i]; break; }
            }
            if (tag == null) { Assert.Ignore("No music cue has a sound attached."); yield break; }
            Story(out var c, new MemoryStorage());
            var player = go.AddComponent<NarrativeCuePlayer>();
            player.controller = c;
            player.cues.Add(new NarrativeCuePlayer.Cue { name = tag.Substring(0, tag.IndexOf(':')), action = NarrativeCuePlayer.CueAction.PlayMusic });
            player.musicFade = 0.2f;
            player.Play(tag.Substring(0, tag.IndexOf(':')), tag.Substring(tag.IndexOf(':') + 1));
            // From Resources at once; with Addressables when it has loaded.
            for (float t = 0f; t < 5f && player.CurrentMusic == null; t += Time.unscaledDeltaTime) yield return null;
            Assert.IsNotNull(player.CurrentMusic, "The music the writer attached (" + file + ") didn't load.");
            yield return new WaitForSecondsRealtime(0.3f);
            Assert.IsTrue(player.musicSource != null && player.musicSource.clip == player.CurrentMusic, "The music isn't on the music source.");
        }

        [UnityTest]
        public IEnumerator SwitchingLanguageTranslatesTheStory()
        {
            if (NarrativeLocalization.Languages.Count == 0) { Assert.Ignore("The translation sheet has no languages yet."); yield break; }
            var before = NarrativeLocalization.Language;
            var view = Story(out var c, new MemoryStorage());
            yield return null;
            c.StartStory();
            try
            {
                NarrativeLocalization.Language = NarrativeLocalization.Languages[0];
                yield return null;
                foreach (var l in c.Transcript)
                    Assert.AreEqual(NarrativeLocalization.Translate(l.SourceText), l.Text, "A line wasn't put into " + NarrativeLocalization.Language + ".");
                Assert.AreEqual(c.HasEnded || c.IsAtExit ? 0 : c.IsWaitingForContinue ? 1 : c.Story.currentChoices.Count, view.Buttons.Count, "The panel's buttons didn't come back after switching language.");
            }
            finally { NarrativeLocalization.Language = before; }
        }
    }
}
`;

const EDITOR_CS = `using System.Collections.Generic;
using System.IO;
using Ink.Runtime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace __NAMESPACE__.EditorTools
{
    /// <summary>
    /// Editor tools for "__MENU_TITLE__": add the story to a scene, a demo scene, the theme, and the smoke test.
    /// A package is read-only, so the demo scene and the editable theme are made in your project's Assets.
    /// Nothing here runs by itself: your scenes and build settings are only changed when you ask.
    /// </summary>
    public static class NarrativeBridgeEditor
    {
        const string Menu = "Tools/Narrative Bridge/__MENU_TITLE__/";
        const string AssetFolder = "__ASSET_FOLDER__";
        const string ScenePath = AssetFolder + "/NarrativeDemo.unity";
        const string ThemePath = AssetFolder + "/NarrativeTheme.asset";

        /// <summary>Where the package is on disk (embedded, from disk or from a tarball alike).</summary>
        static string PackageFolder()
        {
            var info = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(NarrativeController).Assembly);
            return info != null ? info.resolvedPath : null;
        }

        [MenuItem("GameObject/Narrative Bridge/__MENU_TITLE__", false, 10)]
        static void CreateStoryObjectMenu(MenuCommand command)
        {
            var go = CreateStoryObject();
            GameObjectUtility.SetParentAndAlign(go, command.context as GameObject);
            Undo.RegisterCreatedObjectUndo(go, "Create " + go.name);
            Selection.activeObject = go;
        }

        /// <summary>A GameObject with the story's controller and its story panel, in the open scene.</summary>
        public static GameObject CreateStoryObject()
        {
            var go = new GameObject("__MENU_TITLE__ Story");
            var controller = go.AddComponent<NarrativeController>();
            controller.drawDemoUI = false; // the themed story panel replaces the bare-bones IMGUI demo
            var view = go.AddComponent<NarrativeView>();
            view.controller = controller;
            view.theme = LoadOrCreateTheme();
            if (StoryInfo.Cues.Length > 0) AddCuePlayer(go);
            return go;
        }

        /// <summary>Adds (or fills in) a NarrativeCuePlayer listing every cue in the story, with a likely action for each.</summary>
        public static NarrativeCuePlayer AddCuePlayer(GameObject go)
        {
            var player = go.GetComponent<NarrativeCuePlayer>();
            if (player == null) player = Undo.AddComponent<NarrativeCuePlayer>(go);
            else Undo.RecordObject(player, "Fill in cues");
            player.controller = go.GetComponent<NarrativeController>();
            foreach (var name in StoryInfo.Cues)
                if (!player.cues.Exists(c => c != null && c.name == name))
                {
                    var action = NarrativeCuePlayer.Guess(name);
                    // A cue of the writer's own naming with a sound attached plays it.
                    if (action == NarrativeCuePlayer.CueAction.EventOnly && NarrativeCuePlayer.HasStorySounds(name)) action = NarrativeCuePlayer.CueAction.PlaySound;
                    player.cues.Add(new NarrativeCuePlayer.Cue { name = name, action = action });
                }
            EditorUtility.SetDirty(player);
            return player;
        }

        [MenuItem(Menu + "Add Cue Player to Selected Story")]
        static void AddCuePlayerMenu()
        {
            var controller = Selection.activeGameObject != null ? Selection.activeGameObject.GetComponentInParent<NarrativeController>() : UnityEngine.Object.FindAnyObjectByType<NarrativeController>();
            if (controller == null) { Debug.LogWarning("[NarrativeBridge] Select the story's GameObject (the one with the NarrativeController) first."); return; }
            Selection.activeObject = AddCuePlayer(controller.gameObject);
            Debug.Log("[NarrativeBridge] Cue Player added with the story's cues: " + (StoryInfo.Cues.Length > 0 ? string.Join(", ", StoryInfo.CueTags) : "none yet") + ". Give each one its clips.");
        }

        [MenuItem(Menu + "Create Demo Scene")]
        public static void CreateDemoScene()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            NewDemoScene();
            Debug.Log("[NarrativeBridge] Demo scene created at " + ScenePath + ". Press Play to run the story.");
        }

        /// <summary>For a new project only (Narrative Bridge's complete-project export calls it on first open).</summary>
        public static void CreateDemoSceneIfMissing()
        {
            if (File.Exists(ScenePath)) return;
            NewDemoScene();
            if (EditorBuildSettings.scenes.Length == 0) EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            Debug.Log("[NarrativeBridge] Demo scene created at " + ScenePath + ". Press Play to run the story.");
        }

        static void NewDemoScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            CreateStoryObject();
            EnsureFolder(AssetFolder);
            EditorSceneManager.SaveScene(scene, ScenePath);
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var slash = path.LastIndexOf('/');
            EnsureFolder(path.Substring(0, slash));
            AssetDatabase.CreateFolder(path.Substring(0, slash), path.Substring(slash + 1));
        }

        /// <summary>The project's theme asset, made from the exported look the first time.</summary>
        static NarrativeTheme LoadOrCreateTheme()
        {
            var theme = AssetDatabase.LoadAssetAtPath<NarrativeTheme>(ThemePath);
            if (theme != null) return theme;
            EnsureFolder(AssetFolder);
            theme = NarrativeTheme.LoadExported();
            AssetDatabase.CreateAsset(theme, ThemePath);
            AssetDatabase.SaveAssets();
            return theme;
        }

        [MenuItem(Menu + "Reset Theme to Exported Defaults")]
        public static void ResetTheme()
        {
            var theme = LoadOrCreateTheme();
            var exported = Resources.Load<TextAsset>(NarrativeTheme.ExportedResource);
            if (exported == null) { Debug.LogWarning("[NarrativeBridge] Resources/" + NarrativeTheme.ExportedResource + ".json is missing."); return; }
            Undo.RecordObject(theme, "Reset Narrative Bridge theme");
            theme.ApplyExported(exported.text);
            EditorUtility.SetDirty(theme);
            AssetDatabase.SaveAssets();
            Selection.activeObject = theme;
            Debug.Log("[NarrativeBridge] Theme reset to the look exported from Narrative Bridge.");
        }

        [MenuItem(Menu + "Run Story Smoke Test")]
        public static void RunSmokeTestMenu()
        {
            var ok = SmokeTest(false, out var log);
            if (ok) Debug.Log(log); else Debug.LogError(log);
        }

        /// <summary>
        /// Headless engine check: Unity -batchmode -projectPath . -executeMethod __NAMESPACE__.EditorTools.NarrativeBridgeEditor.RunSmokeTestBatch
        /// Requires the ink compiler inside Unity to compile the story's source (no fallback), then plays it. Exit code 0 = pass.
        /// </summary>
        public static void RunSmokeTestBatch()
        {
            var ok = SmokeTest(true, out var log);
            Debug.Log(log);
            EditorApplication.Exit(ok ? 0 : 1);
        }

        /// Compiles the package's ink source with Ink Unity Integration's compiler, so the check also covers
        /// the engine side building the story. Returns the compiled JSON, or null (with the reason in errors).
        static string CompileInkSource(List<string> errors)
        {
            var root = PackageFolder();
            // Ink.Runtime has a Path too, so System.IO's is named in full.
            var path = root != null ? System.IO.Path.Combine(root, "Ink~", "MainStory.ink") : null;
            if (path == null || !File.Exists(path)) { errors.Add("The story's ink source (Ink~/MainStory.ink) is not in the package."); return null; }
            var problems = new List<string>();
            var compiler = new Ink.Compiler(File.ReadAllText(path), new Ink.Compiler.Options
            {
                sourceFilename = "MainStory.ink",
                errorHandler = (message, type) => { if (type == Ink.ErrorType.Error) problems.Add(message); },
            });
            Story compiled = null;
            try { compiled = compiler.Compile(); } catch (System.Exception e) { problems.Add(e.Message); }
            if (compiled == null || problems.Count > 0) { errors.Add("The ink compiler in Unity could not compile MainStory.ink: " + string.Join("; ", problems)); return null; }
            return compiled.ToJson();
        }

        static bool SmokeTest(bool requireEngineCompile, out string log)
        {
            var errors = new List<string>();
            var engineJson = CompileInkSource(errors);
            if (engineJson == null && requireEngineCompile)
            {
                log = "[NarrativeBridge] Smoke test failed: " + string.Join("; ", errors);
                return false;
            }
            // The game runs the precompiled story that ships in the package: it must load in this ink runtime.
            var shipped = Resources.Load<TextAsset>(StoryInfo.CompiledResource);
            if (shipped == null) errors.Add("The compiled story (Resources/" + StoryInfo.CompiledResource + ".json) did not import.");
            else
            {
                try { new Story(shipped.text); }
                catch (System.Exception e) { errors.Add("The compiled story does not load: " + e.Message); }
            }
            string json = engineJson ?? (shipped != null ? shipped.text : null);
            var source = engineJson != null ? "ink compiler in Unity" : "shipped JSON";
            if (json == null) { log = "[NarrativeBridge] Smoke test failed: compiled story not found. " + string.Join("; ", errors); return false; }
            var clipsHeard = new HashSet<string>();
            var picturesSeen = new HashSet<string>();
            int completed = 0;
            var rng = new System.Random(1234);
            const int runs = 50;
            for (int r = 0; r < runs; r++)
            {
                var story = new Story(json);
                story.onError += (m, t) => { if (t == Ink.ErrorType.Error) errors.Add(m); };
                int steps = 0;
                while (steps++ < 400)
                {
                    while (story.canContinue)
                    {
                        story.Continue();
                        foreach (var t in story.currentTags)
                        {
                            if (t.StartsWith("audio:")) clipsHeard.Add(t.Substring(6).Trim());
                            else if (t.StartsWith("image:")) picturesSeen.Add(t.Substring(6).Trim());
                        }
                    }
                    if (story.currentChoices.Count == 0) { completed++; break; }
                    story.ChooseChoiceIndex(rng.Next(story.currentChoices.Count));
                }
            }
            // Every voice clip a line refers to must have imported as an AudioClip.
            foreach (var file in clipsHeard)
            {
                if (NarrativeController.LoadVoiceClip(file) == null)
                    errors.Add("Voice clip did not import" + (StoryInfo.UsesAddressables ? " (or isn't in Addressables)" : "") + ": " + file);
            }
            // And every scene picture and character portrait must decode.
            foreach (var file in picturesSeen)
                if (NarrativeController.LoadPicture(file) == null) errors.Add("Scene picture could not be loaded: " + file);
            foreach (var speaker in StoryInfo.PortraitSpeakers)
                if (NarrativeController.LoadPortrait(speaker) == null) errors.Add("Portrait could not be loaded: " + speaker);
            var addressables = AddressablesCheck(clipsHeard, picturesSeen, errors);
            var carry = SaveCarryOverCheck(errors);
            var startAt = StartAtCheck(errors);
            var exit = ExitCheck(errors);
            var ui = StoryViewCheck(errors);
            var gates = LockedChoiceCheck(json, errors);
            var cueResult = CueCheck(errors);
            var slots = SaveSlotCheck(errors);
            var translation = TranslationCheck(errors);
            var routeResult = "no playthrough routes";
            if (StoryRoutes.All.Length > 0)
            {
                var routesOk = PlaythroughRunner.RunAll(out var routeLog);
                if (!routesOk) errors.Add(routeLog);
                routeResult = routesOk ? "playthrough routes passed (" + StoryRoutes.All.Length + ")" : "playthrough routes failed";
            }
            log = "[NarrativeBridge] Smoke test (" + source + "): " + clipsHeard.Count + " voice clip(s), " + picturesSeen.Count + " picture(s) and " + StoryInfo.PortraitSpeakers.Length + " portrait(s) checked" + addressables + ", " + completed + "/" + runs + " playthroughs reached an ending, "  + carry + ", " + startAt + ", " + exit + ", " + ui + ", " + gates + ", " + cueResult + ", " + slots + ", " + translation + ", " + routeResult + ", " + errors.Count + " runtime errors." +
                  (errors.Count > 0 ? "\\n" + string.Join("\\n", errors) : "");
            return errors.Count == 0 && completed > 0;
        }

        /// Makes up a language from the sheet ("[xx] " before every source text), plays the story in it, and checks every
        /// line, choice and name the story shows was found in the sheet: the keys Narrative Bridge wrote match the ones
        /// the controller computes. The player's language and the package's sheet are put back afterwards.
        static string TranslationCheck(List<string> errors)
        {
            var rows = NarrativeLocalization.ReadSheet();
            if (rows.Count < 2) { errors.Add("Translations: the translation sheet (Resources/" + StoryInfo.TranslationsResource + ".csv) is missing or empty."); return "translations failed"; }
            var source = System.Array.IndexOf(rows[0], "source");
            var csv = new System.Text.StringBuilder("key,kind,passage,source,xx\\n");
            for (int r = 1; r < rows.Count; r++) csv.Append(rows[r][0]).Append(",,,,\\"[xx] ").Append(rows[r][source].Replace("\\"", "\\"\\"")).Append("\\"\\n");
            var hadLanguage = PlayerPrefs.HasKey("NarrativeBridge.Language");
            var before = NarrativeLocalization.Language;
            var go = new GameObject("NarrativeBridge translation check");
            try
            {
                NarrativeLocalization.UseSheet(new TextAsset(csv.ToString()));
                NarrativeLocalization.Language = "xx";
                var c = go.AddComponent<NarrativeController>();
                c.drawDemoUI = false;
                c.StartStory();
                var missing = new List<string>();
                var shown = 0;
                for (int step = 0; step < 300 && c.Story != null; step++)
                {
                    // (At an exit to the game the panel steps aside: its lone choice is never shown.)
                    if (!c.IsAtExit) foreach (var choice in c.Story.currentChoices)
                    {
                        var t = NarrativeController.ChoiceText(choice);
                        if (!t.StartsWith("[xx] ")) missing.Add("choice \\"" + choice.text + "\\"");
                    }
                    if (c.HasEnded || c.Story.currentChoices.Count == 0) break;
                    c.Choose(0);
                }
                foreach (var l in c.Transcript)
                {
                    shown++;
                    if (!l.Text.StartsWith("[xx] ")) missing.Add("line \\"" + l.SourceText + "\\"");
                    if (l.Speaker != null && !l.Speaker.StartsWith("[xx] ")) missing.Add("speaker " + l.SourceSpeaker);
                }
                if (missing.Count > 0) { errors.Add("Translations: not found in the sheet: " + string.Join("; ", missing.GetRange(0, System.Math.Min(5, missing.Count)))); return "translations failed"; }
                // Back to the story as written: the transcript follows.
                NarrativeLocalization.Language = "";
                if (!Application.isPlaying) c.Relocalize(); // a playing controller does this itself (OnEnable subscribes it)
                foreach (var l in c.Transcript) if (l.Text.StartsWith("[xx] ")) { errors.Add("Translations: switching back to the story's own language left a translated line."); return "translations failed"; }
                return "translations passed (" + (rows.Count - 1) + " in the sheet, " + shown + " lines checked)";
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(go);
                NarrativeLocalization.UseSheet(null);
                NarrativeLocalization.Language = before;
                if (!hadLanguage) PlayerPrefs.DeleteKey("NarrativeBridge.Language");
            }
        }

        /// Save slots kept in memory for the check (the game's own files are never touched).
        class MemoryStorage : ISaveStorage
        {
            public readonly Dictionary<string, string> Saves = new Dictionary<string, string>();
            public void Write(string key, string data) => Saves[key] = data;
            public string Read(string key) => Saves.TryGetValue(key, out var d) ? d : null;
            public void Delete(string key) => Saves.Remove(key);
        }

        /// Saves part-way into a slot, plays on, loads the slot back (same choices as when saved), checks what the
        /// slot says about itself, then the panel's Load menu lists the slots, and a slot can be deleted.
        static string SaveSlotCheck(List<string> errors)
        {
            var go = new GameObject("NarrativeBridge save slot check");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                c.drawDemoUI = false;
                c.saveSlots = 3;
                c.Storage = new MemoryStorage();
                c.StartStory();
                if (c.Story == null) { errors.Add("Save slots: the story did not start."); return "save slots failed"; }
                for (int i = 0; i < 2 && c.Story.currentChoices.Count > 0; i++) c.Choose(0);
                var expected = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text));
                var passage = c.CurrentPassage;
                c.SaveToSlot(2);
                for (int i = 0; i < 3 && c.Story.currentChoices.Count > 0; i++) c.Choose(c.Story.currentChoices.Count - 1);
                if (!c.LoadFromSlot(2)) { errors.Add("Save slots: slot 2 did not load: " + c.Status); return "save slots failed"; }
                var got = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text));
                if (got != expected) { errors.Add("Save slots: expected choices [" + expected + "] after loading but got [" + got + "]"); return "save slots failed"; }
                var info = c.GetSlot(2);
                if (!info.Exists || info.Passage != passage || string.IsNullOrEmpty(info.PassageTitle) || info.SavedAt == default(System.DateTime)) { errors.Add("Save slots: slot 2 doesn't say where and when it was saved."); return "save slots failed"; }
                if (c.GetSlot(1).Exists || c.LoadFromSlot(1)) { errors.Add("Save slots: an empty slot loaded."); return "save slots failed"; }
                var view = go.AddComponent<NarrativeView>();
                view.controller = c;
                view.theme = NarrativeTheme.LoadExported();
                view.Build();
                view.OpenSaveSlots(false);
                // Load menu: the autosave and 3 slots, then Close; only slot 2 can be loaded.
                var loadable = 0;
                foreach (var b in view.SettingsButtons) if (b.interactable) loadable++;
                if (!view.SlotsOpen || view.SettingsButtons.Count != 5 || loadable != 2) { errors.Add("Save slots: the Load menu shows " + view.SettingsButtons.Count + " buttons (" + loadable + " usable) instead of 5 (2 usable)."); return "save slots failed"; }
                view.SettingsButtons[2].onClick.Invoke(); // slot 2
                if (view.SlotsOpen || string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text)) != expected) { errors.Add("Save slots: loading from the menu didn't load slot 2."); return "save slots failed"; }
                c.DeleteSlot(2);
                if (c.GetSlot(2).Exists) { errors.Add("Save slots: slot 2 was not deleted."); return "save slots failed"; }
                // The default storage: files in a folder (a temporary one here).
                var folder = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "NarrativeBridgeSlotCheck-" + System.Guid.NewGuid().ToString("N"));
                try
                {
                    var files = new FileSaveStorage(folder);
                    files.Write("slot-1", c.SaveState());
                    files.Write("slot-1", c.SaveState()); // over an existing save
                    if (files.Read("slot-1") == null || files.Read("slot-9") != null) { errors.Add("Save slots: file storage did not read back what it wrote."); return "save slots failed"; }
                    files.Delete("slot-1");
                    if (files.Read("slot-1") != null) { errors.Add("Save slots: file storage did not delete."); return "save slots failed"; }
                }
                finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
                return "save slots passed (files and menu)";
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// Plays the story with a Cue Player set up as Add Cue Player does (with no clips yet): every cue the story
        /// reaches is one of StoryInfo.Cues, and none of them fails.
        static string CueCheck(List<string> errors)
        {
            if (StoryInfo.Cues.Length == 0) return "no cues";
            var go = new GameObject("NarrativeBridge cue check");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                c.startOnAwake = false;
                var player = AddCuePlayer(go);
                var heard = new HashSet<string>();
                player.CuePlayed += (name, value) =>
                {
                    heard.Add(name);
                    if (System.Array.IndexOf(StoryInfo.Cues, name) < 0) errors.Add("Cue: the story reached a cue that isn't in StoryInfo.Cues: " + name);
                };
                player.enabled = false; player.enabled = true; // subscribe now (OnEnable)
                var rng = new System.Random(7);
                for (int run = 0; run < 20; run++)
                {
                    c.StartStory();
                    for (int i = 0; i < 300 && c.Story != null && !c.HasEnded; i++)
                    {
                        if (c.IsAtExit) c.Resume();
                        else if (c.IsWaitingForContinue) c.Continue();
                        else if (c.Story.currentChoices.Count > 0) c.Choose(rng.Next(c.Story.currentChoices.Count));
                        else break;
                    }
                }
                foreach (var file in StoryInfo.CueSoundFiles)
                    if (NarrativeController.LoadVoiceClip(file) == null) errors.Add("Cue sound did not import" + (StoryInfo.UsesAddressables ? " (or isn't in Addressables)" : "") + ": " + file);
                foreach (var tag in StoryInfo.CueTags)
                {
                    var colon = tag.IndexOf(':');
                    player.Play(colon < 0 ? tag : tag.Substring(0, colon), colon < 0 ? "" : tag.Substring(colon + 1));
                }
                // A music cue with the writer's sound plays that sound (no clips of the game's own here).
                for (int i = 0; i < StoryInfo.CueSoundTags.Length; i++)
                {
                    var tag = StoryInfo.CueSoundTags[i];
                    var colon = tag.IndexOf(':');
                    var name = colon < 0 ? tag : tag.Substring(0, colon);
                    if (NarrativeCuePlayer.Guess(name) != NarrativeCuePlayer.CueAction.PlayMusic) continue;
                    player.Play(name, colon < 0 ? "" : tag.Substring(colon + 1));
                    var file = StoryInfo.CueSoundFiles[i];
                    var dot = file.LastIndexOf('.');
                    if (player.CurrentMusic == null || player.CurrentMusic.name != (dot > 0 ? file.Substring(0, dot) : file))
                        errors.Add("Cue: " + tag + " didn't play the sound the writer attached (" + file + ").");
                }
                return "cues passed (" + heard.Count + " of " + StoryInfo.Cues.Length + " reached" + (StoryInfo.CueSoundFiles.Length > 0 ? ", " + StoryInfo.CueSoundFiles.Length + " sound(s)" : "") + ")";
            }
            catch (System.Exception e) { errors.Add("Cue: " + e.Message); return "cues failed"; }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// With Addressables: every voice clip, picture and portrait is in the story's group, at the address the
        /// controller asks for (the group is set up first if it's missing).
        static string AddressablesCheck(HashSet<string> clipsHeard, HashSet<string> picturesSeen, List<string> errors)
        {
            if (!StoryInfo.UsesAddressables) return "";
#if NARRATIVE_BRIDGE_ADDRESSABLES
            var settings = UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings;
            if (settings == null || settings.FindGroup(AddressablesSetup.GroupName) == null) AddressablesSetup.SetUp();
            settings = UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings;
            var group = settings != null ? settings.FindGroup(AddressablesSetup.GroupName) : null;
            if (group == null) { errors.Add("Addressables: the group " + AddressablesSetup.GroupName + " could not be made."); return " (Addressables failed)"; }
            var addresses = new HashSet<string>();
            foreach (var e in group.entries) addresses.Add(e.address);
            var wanted = new List<string>();
            foreach (var file in clipsHeard) { var dot = file.LastIndexOf('.'); wanted.Add(StoryInfo.AddressPrefix + "Audio/" + (dot > 0 ? file.Substring(0, dot) : file)); }
            foreach (var file in picturesSeen) wanted.Add(StoryInfo.AddressPrefix + "Images/" + file);
            foreach (var file in StoryInfo.CueSoundFiles) { var dot = file.LastIndexOf('.'); wanted.Add(StoryInfo.AddressPrefix + "Audio/" + (dot > 0 ? file.Substring(0, dot) : file)); }
            foreach (var f in StoryInfo.PortraitFiles) wanted.Add(StoryInfo.AddressPrefix + "Images/" + f);
            foreach (var a in wanted) if (!addresses.Contains(a)) errors.Add("Addressables: nothing has the address " + a + ".");
            return " (with Addressables, " + addresses.Count + " in the group)";
#else
            errors.Add("This story loads its voice clips and pictures with Addressables, but the Addressables package isn't installed.");
            return " (Addressables missing)";
#endif
        }

        /// Every locked-choice condition names a real passage and real story variables.
        static string LockedChoiceCheck(string json, List<string> errors)
        {
            if (StoryInfo.GatedChoices.Length == 0) return "no locked choices";
            var story = new Story(json);
            var before = errors.Count;
            foreach (var g in StoryInfo.GatedChoices)
            {
                if (System.Array.IndexOf(StoryInfo.Passages, g.Passage) < 0) errors.Add("Locked choice \\"" + g.Text + "\\" is in an unknown passage " + g.Passage + ".");
                g.Missing(name =>
                {
                    if (!story.variablesState.GlobalVariableExistsWithName(name)) { errors.Add("Locked choice \\"" + g.Text + "\\" reads an unknown variable " + name + "."); return null; }
                    return story.variablesState[name];
                });
            }
            return errors.Count == before ? "locked choices passed (" + StoryInfo.GatedChoices.Length + ")" : "locked choices failed";
        }

        /// Saves part-way through, then loads that save as if it came from an earlier story version:
        /// the controller must replay the choices and land on the same choices as an exact load.
        static string SaveCarryOverCheck(List<string> errors)
        {
            var go = new GameObject("NarrativeBridge smoke test");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                c.StartStory();
                if (c.Story == null) { errors.Add("Save carry-over: the controller could not start the story."); return "save carry-over not run"; }
                for (int i = 0; i < 3 && c.Story.currentChoices.Count > 0; i++) c.Choose(0);
                var expected = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text));
                var save = c.SaveState();
                var older = save.Replace("\\"storyVersion\\":\\"" + StoryInfo.StoryVersion + "\\"", "\\"storyVersion\\":\\"earlier\\"");
                c.StartStory();
                if (!c.TryLoadState(older, out var err)) { errors.Add("Save carry-over: " + err); return "save carry-over failed"; }
                var got = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text));
                if (got != expected || c.LoadNote == null) { errors.Add("Save carry-over: expected choices [" + expected + "] but got [" + got + "]"); return "save carry-over failed"; }
                return "save carry-over passed";
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// Starts the story at every passage, as a game does for a conversation, without runtime errors.
        static string StartAtCheck(List<string> errors)
        {
            var go = new GameObject("NarrativeBridge start-at check");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                var before = errors.Count;
                c.RuntimeError += m => errors.Add("StartAt: " + m);
                foreach (var p in StoryInfo.Passages)
                {
                    c.StartAt(p);
                    if (c.Story == null || c.StartPassage != p) { errors.Add("StartAt(" + p + ") did not start the story there."); break; }
                }
                return errors.Count == before ? "start-at passed (" + StoryInfo.Passages.Length + " passages)" : "start-at failed";
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// Plays to an exit to the game, resumes at another passage (as a game does after a fight it lost),
        /// and checks a save made after that jump carries over to a revised story.
        static string ExitCheck(List<string> errors)
        {
            if (StoryInfo.Exits.Length == 0) return "no exits to the game";
            var go = new GameObject("NarrativeBridge exit check");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                string reached = null;
                c.ExitReached += e => reached = e;
                c.StartStory();
                for (int i = 0; i < 300 && reached == null && c.Story != null && !c.HasEnded; i++)
                {
                    if (c.IsWaitingForContinue) c.Continue();
                    else if (c.Story.currentChoices.Count > 0) c.Choose(0);
                }
                if (reached == null) return "exits not reached by the first choices";
                if (System.Array.IndexOf(StoryInfo.Exits, reached) < 0) { errors.Add("Exit: " + reached + " is not in StoryInfo.Exits."); return "exits failed"; }
                c.ResumeAt(StoryInfo.Passages[StoryInfo.Passages.Length - 1]);
                if (c.IsAtExit && c.CurrentExit == reached) { errors.Add("Exit: ResumeAt did not leave the exit."); return "exits failed"; }
                var expected = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text)) + "/" + c.HasEnded;
                var save = c.SaveState().Replace("\\"storyVersion\\":\\"" + StoryInfo.StoryVersion + "\\"", "\\"storyVersion\\":\\"earlier\\"");
                c.StartStory();
                if (!c.TryLoadState(save, out var err)) { errors.Add("Exit: " + err); return "exits failed"; }
                var got = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text)) + "/" + c.HasEnded;
                if (got != expected) { errors.Add("Exit: after ResumeAt, a carried-over save expected [" + expected + "] but got [" + got + "]"); return "exits failed"; }
                return "exits passed (" + reached + ", resumed elsewhere, save carried over)";
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// Builds the story panel from the exported theme and plays a few steps through its buttons:
        /// one button per choice (one for a Continue break), clicks advance the story, the ending shows.
        static string StoryViewCheck(List<string> errors)
        {
            var go = new GameObject("NarrativeBridge view check");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                c.drawDemoUI = false;
                var view = go.AddComponent<NarrativeView>();
                view.controller = c;
                view.theme = NarrativeTheme.LoadExported();
                view.Build();
                c.StartStory();
                if (c.Story == null || view.Canvas == null) { errors.Add("Story UI: the panel was not built."); return "story UI failed"; }
                var textKind = "Text";
#if NARRATIVE_BRIDGE_TMP
                // Unity's current text system when the game has it.
                if (view.Canvas.GetComponentsInChildren<TMPro.TextMeshProUGUI>(true).Length == 0) { errors.Add("Story UI: TextMeshPro is available but the panel doesn't use it."); return "story UI failed"; }
                textKind = "TextMeshPro";
#endif
                var steps = 0;
                var pictures = 0;
                var portraits = 0;
                var exits = 0;
                var locked = 0;
                var settings = SettingsCheck(view, errors);
                if (settings == null) return "story UI failed";
                // Emphasis from the script: typed a letter at a time with its tags closed; any other markup shows as written.
                var typedCheck = NarrativeView.Typed("a <i>bold</i> move", 4);
                if (typedCheck != "a <i>bo</i>" || NarrativeView.Plain("<b>x</b><i>y</i>") != "xy") { errors.Add("Story UI: emphasis is typed wrongly (" + typedCheck + ")."); return "story UI failed"; }
                var escaped = NarrativeView.Markup("<i>a</i> <color=red>b");
                if (!escaped.StartsWith("<i>a</i> ") || escaped.Contains("<color=red>")) { errors.Add("Story UI: markup in the story's text is read as tags (" + escaped + ")."); return "story UI failed"; }
                while (!c.HasEnded && steps++ < 200)
                {
                    // The scene the reader is in shows its picture (when the theme shows pictures).
                    var file = c.CurrentPicture;
                    if (file != null && view.theme.showPictures)
                    {
                        if (view.Picture == null) { errors.Add("Story UI: the scene picture " + file + " is not shown."); return "story UI failed"; }
                        pictures++;
                    }
                    // The last line spoken by a character with a portrait shows it (when the theme shows portraits).
                    string speaker = null;
                    for (int i = c.Transcript.Count - 1; i >= 0; i--) if (!c.Transcript[i].IsChoice) { speaker = c.Transcript[i].SpeakerId; break; }
                    if (speaker != null && view.theme.showPortraits && NarrativeController.PortraitFile(speaker) != null)
                    {
                        if (view.Portrait == null) { errors.Add("Story UI: the portrait of " + speaker + " is not shown."); return "story UI failed"; }
                        portraits++;
                    }
                    // An exit to the game: the panel steps aside until the game resumes the story.
                    if (c.IsAtExit)
                    {
                        if (view.hideDuringExits && view.Visible) { errors.Add("Story UI: the panel still shows at the exit " + c.CurrentExit + "."); return "story UI failed"; }
                        exits++;
                        c.Resume();
                        if (!view.Visible && !c.IsAtExit) { errors.Add("Story UI: the panel did not come back after resuming."); return "story UI failed"; }
                        continue;
                    }
                    var expected = c.IsWaitingForContinue ? 1 : c.Story.currentChoices.Count;
                    if (view.Buttons.Count != expected) { errors.Add("Story UI: expected " + expected + " button(s) but the panel shows " + view.Buttons.Count + "."); return "story UI failed"; }
                    // Locked choices show greyed out, and can't be clicked.
                    var lockedNow = view.theme.showLockedChoices ? c.LockedChoices.Count : 0;
                    if (view.LockedButtons.Count != lockedNow) { errors.Add("Story UI: expected " + lockedNow + " locked choice(s) but the panel shows " + view.LockedButtons.Count + "."); return "story UI failed"; }
                    foreach (var b in view.LockedButtons) if (b.interactable) { errors.Add("Story UI: a locked choice can be clicked."); return "story UI failed"; }
                    locked += lockedNow;
                    var before = c.Transcript.Count + "/" + c.Story.state.currentTurnIndex;
                    view.Buttons[0].onClick.Invoke();
                    if (before == c.Transcript.Count + "/" + c.Story.state.currentTurnIndex) { errors.Add("Story UI: clicking a button did not advance the story."); return "story UI failed"; }
                }
                if (!c.HasEnded) return "story UI passed (" + steps + " steps, no ending within the check)";
                if (view.Buttons.Count != 0) { errors.Add("Story UI: buttons are still shown after the ending."); return "story UI failed"; }
                return "story UI passed (" + textKind + ")" + (pictures > 0 ? " with pictures" : "") + (portraits > 0 ? (pictures > 0 ? " and portraits" : " with portraits") : "") + (exits > 0 ? ", " + exits + " exit(s) to the game and back" : "") + (locked > 0 ? ", " + locked + " locked choice(s) shown" : "") + ", " + settings;
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// Opens the player's Settings menu, changes the text size, and checks the panel follows; the
        /// player's own settings are put back afterwards.
        static string SettingsCheck(NarrativeView view, List<string> errors)
        {
            if (!view.theme.showSettings || !view.theme.showToolbar) return "settings menu off";
            var scale = NarrativeSettings.TextScale;
            var contrast = NarrativeSettings.HighContrast;
            try
            {
                view.OpenSettings();
                var rows = NarrativeLocalization.Languages.Count > 0 ? 8 : 7; // a Language row when there are translations
                if (!view.SettingsOpen || view.SettingsButtons.Count != rows) { errors.Add("Settings: expected " + rows + " buttons in the menu but it has " + view.SettingsButtons.Count + "."); return null; }
                NarrativeSettings.TextScale = 1f;
                view.SettingsButtons[0].onClick.Invoke(); // text size, one step up
                view.SettingsButtons[3].onClick.Invoke(); // high contrast
                view.Build(); // a playing panel rebuilds itself; in the editor it's done here
                if (Mathf.Abs(NarrativeSettings.TextScale - 1.15f) > 0.01f || NarrativeSettings.HighContrast == contrast) { errors.Add("Settings: the menu's buttons didn't change the settings."); return null; }
                if (!view.SettingsOpen || view.SettingsButtons.Count != rows) { errors.Add("Settings: the menu closed when a setting changed."); return null; }
                view.SettingsButtons[rows - 1].onClick.Invoke(); // close
                if (view.SettingsOpen) { errors.Add("Settings: Close didn't close the menu."); return null; }
                return "settings menu passed";
            }
            finally
            {
                NarrativeSettings.TextScale = scale;
                NarrativeSettings.HighContrast = contrast;
                view.Build();
                view.Redraw();
            }
        }
    }
}
`;
