import { log } from '../log';
import type { ProcessedStory } from '../pipeline';
import { portraitFiles } from '../images';
import { cueName, cueTag, exitName, isActive, itemVar, type Condition } from '../isr';
import { describeCondition } from '../gating';
import { assertExportable, audioFiles, buildManifest, imageFiles, commonFiles, itemVarNames, json, sourceFiles, storyVersion, verifyExport } from './common';
import type { EngineAdapter, ExportFile, ExportOptions, ExportResult } from './types';
import { storyRoutes, type StoryRoute } from './routes';
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
    const voice = audioFiles(story, options.audio, `${res}Audio/`);
    // Scene pictures ship as their PNG/JPEG bytes (Images/<file>.bytes) and are decoded at run time: no
    // texture import settings to depend on, the same in every Unity version, and kept at full size.
    const pictures = imageFiles(story, options.images, `${res}Images/`, '.bytes');
    const cs = (template: string) => fillTemplate(template, id, { __INK_URL__: unityPackageUrl(options.integrationRef), __ASSET_FOLDER__: `Assets/NarrativeBridge/${id.namespace.split('.').pop()}` });
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
      { path: `${pkg}Runtime/StoryInfo.cs`, content: storyInfoCs(story, id) },
      { path: `${pkg}Runtime/IInventoryAuthority.cs`, content: cs(INVENTORY_CS) },
      { path: `${pkg}Runtime/GatedChoice.cs`, content: cs(GATED_CHOICE_CS) },
      { path: `${pkg}Runtime/SaveStorage.cs`, content: cs(SAVE_STORAGE_CS) },
      { path: `${pkg}Runtime/NarrativeCuePlayer.cs`, content: cs(CUE_PLAYER_CS) },
      { path: `${pkg}Runtime/NarrativeController.cs`, content: cs(CONTROLLER_CS) },
      { path: `${pkg}Runtime/NarrativeTheme.cs`, content: cs(THEME_CS) },
      { path: `${pkg}Runtime/NarrativeView.cs`, content: cs(VIEW_CS) },
      { path: `${pkg}Runtime/NarrativeSettings.cs`, content: cs(SETTINGS_CS) },
      { path: `${res}MainStory.compiled.json`, content: story.compile.json! },
      // The look chosen on the Export page; NarrativeTheme reads it (see unityTheme.ts).
      { path: `${res}Theme.json`, content: json(unityThemeJson(normaliseUnityTheme(options.unityTheme ?? story.project.presentation?.unity))) },
      ...voice.files,
      ...pictures.files,
      { path: `${pkg}Editor/${id.namespace}.Editor.asmdef`, content: json(editorAsmdef(id)) },
      { path: `${pkg}Editor/NarrativeBridgeEditor.cs`, content: cs(EDITOR_CS) },
      { path: `${pkg}Editor/StoryDebuggerWindow.cs`, content: cs(DEBUGGER_CS) },
      { path: `${pkg}Editor/StoryRoutes.cs`, content: storyRoutesCs(routes, id) },
      { path: `${pkg}Editor/PlaythroughRunner.cs`, content: cs(ROUTES_RUNNER_CS) },
      { path: `${pkg}Tests/Editor/${id.namespace}.Tests.asmdef`, content: json(testsAsmdef(id)) },
      { path: `${pkg}Tests/Editor/PlaythroughTests.cs`, content: cs(ROUTE_TESTS_CS) },
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

function storyInfoCs(story: ProcessedStory, id: UnityPackageId): string {
  const items = itemVarNames(story);
  const vars = story.project.variables.map((v) => v.id);
  const passages = [...story.generated.ink.matchAll(/^=== (\w+) ===$/gm)].map((m) => m[1]);
  const portraits = Object.entries(portraitFiles(story.project));
  const exits = [...new Set(story.project.passages.flatMap((p) => p.content.flatMap((b) => (b.type === 'exit' ? [exitName(b.name)] : []))))];
  const cueBlocks = story.project.passages.flatMap((p) => p.content.flatMap((b) => (b.type === 'cue' ? [b] : [])));
  const cues = [...new Set(cueBlocks.map((b) => cueName(b.name)))];
  const cueTags = [...new Set(cueBlocks.map((b) => cueTag(b.name, b.value)))];
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

## Cues
Writers add cues in Narrative Bridge: music, a sound, an ambience, a camera shake, or a name of their own, with an optional
value (\`#music:calm\`, \`#sound:door_creak\`, \`#shake:0.5\`). They're listed in \`StoryInfo.Cues\` (and with their values in
\`StoryInfo.CueTags\`). The **NarrativeCuePlayer** plays them without code: *Tools → Narrative Bridge → ${id.menuTitle} → Add Cue
Player to Selected Story* lists every cue with a likely action (play or stop music, play a sound, loop an ambience, shake the
camera, or only raise its event); give each one its clips, named after the values (a clip called *calm* for \`music:calm\`).
Each cue also has a UnityEvent, \`CuePlayed\` reports every cue from code, and \`TagFound\` still sees them all. A music cue
with no value stops the music. (Stories added to a scene after this export get a Cue Player automatically.)

## Story Debugger
*Tools → Narrative Bridge → ${id.menuTitle} → Story Debugger* follows the story while the game plays: the passage the reader
is in, what it's waiting for, the choices (click one to choose it) and the locked ones, every story variable and item (change
them to try a route), a jump to any passage, and saves copied to or loaded from the clipboard.

## Player settings
The panel's *Settings* button opens a menu where the player sets the text size, typing speed (slow, normal, fast or
instant), whether it goes on by itself, high contrast (light text on a solid dark panel) and the voice volume. They're kept
in PlayerPrefs and shared by every Narrative Bridge story in the game. Your own options menu can set the same things
through \`NarrativeSettings\` (\`TextScale\`, \`TypingSpeed\`, \`AutoAdvance\`, \`HighContrast\`, \`VoiceVolume\`, \`Reset()\`); the
menu's words are in the view's *Settings Words*.

## Updating
Export the story again and replace this folder (or install the new .tgz). Script GUIDs stay the same, so your scenes
keep their references. Your NarrativeTheme asset is never overwritten.

## What's inside
- \`Runtime/\`: the controller, view, theme, \`StoryInfo\`, and the story in \`Resources/NarrativeBridge/${id.slug}/\`
  (the compiled story, its look, voice clips, and scene pictures as their PNG/JPEG bytes).
- \`Editor/\`: menus, the demo scene, the smoke test, the Story Debugger and the playthrough routes; \`Editor/Setup\` installs Ink when needed.
- \`Tests/Editor/\`: the playthrough routes as Test Runner tests.
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
                Run(cue, value);
                cue.onCue.Invoke(value);
            }
        }

        void Run(Cue cue, string value)
        {
            switch (cue.action)
            {
                case CueAction.PlayMusic:
                    // A music cue with no value stops the music.
                    if (string.IsNullOrEmpty(value)) StopMusic();
                    else PlayMusic(Pick(cue, value), cue.volume);
                    break;
                case CueAction.StopMusic:
                    StopMusic();
                    break;
                case CueAction.PlaySound:
                    var sound = Pick(cue, value);
                    if (sound != null) Source(ref soundSource, "Cue Sounds", false).PlayOneShot(sound, cue.volume);
                    break;
                case CueAction.PlayAmbience:
                    var loop = Pick(cue, value);
                    var ambience = Source(ref ambienceSource, "Cue Ambience", true);
                    if (loop == null || string.IsNullOrEmpty(value) && cue.clips.Count == 0) { ambience.Stop(); break; }
                    if (ambience.clip == loop && ambience.isPlaying) break;
                    ambience.clip = loop;
                    ambience.volume = cue.volume;
                    ambience.Play();
                    break;
                case CueAction.StopAmbience:
                    if (ambienceSource != null) ambienceSource.Stop();
                    break;
                case CueAction.ShakeCamera:
                    Shake(float.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var strength) ? Mathf.Clamp01(strength) : 0.5f);
                    break;
            }
        }

        /// <summary>The clip named by the value, else the cue's first clip; null when it has none.</summary>
        static AudioClip Pick(Cue cue, string value)
        {
            if (!string.IsNullOrEmpty(value))
            {
                foreach (var c in cue.clips) if (c != null && string.Equals(c.name, value, StringComparison.OrdinalIgnoreCase)) return c;
                if (cue.clips.Count > 0) Debug.LogWarning("[NarrativeBridge] No clip called " + value + " for the " + cue.name + " cue; playing its first clip.");
            }
            foreach (var c in cue.clips) if (c != null) return c;
            return null;
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

const CONTROLLER_CS = `using System;
using System.Collections.Generic;
using Ink.Runtime;
using UnityEngine;
using UnityEngine.Events;

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
                foreach (var g in StoryInfo.GatedChoices)
                {
                    if (g.Passage != passage || Story.currentChoices.Exists(c => c.text == g.Text)) continue;
                    var missing = g.Missing(ReadVariable);
                    if (missing.Length > 0) locked.Add(new LockedChoice { Text = g.Text, Needs = string.Join(", ", missing) });
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
        readonly Queue<AudioClip> voiceQueue = new Queue<AudioClip>();
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
            if (startOnAwake) StartStory();
        }

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
                transcript.Add(new Line { Speaker = null, Text = Story.currentChoices[index].text, Tags = new List<string> { "choice" }, IsChoice = true });
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
            t == "transition" || t.StartsWith("speaker:") || t.StartsWith("scene:") || t.StartsWith("paren:") || t.StartsWith("image:") || t.StartsWith("audio:");

        // ---- Voice clips: lines tagged #audio:<file> play in order --------------------------

        void QueueVoice(Line line)
        {
            if (!playVoiceClips || voice == null) return;
            foreach (var t in line.Tags)
            {
                if (!t.StartsWith("audio:")) continue;
                var file = t.Substring(6).Trim();
                var dot = file.LastIndexOf('.');
                var clip = Resources.Load<AudioClip>(StoryInfo.AudioFolder + (dot > 0 ? file.Substring(0, dot) : file));
                if (clip != null) voiceQueue.Enqueue(clip);
                else Debug.LogWarning("[NarrativeBridge] Voice clip not found: " + file);
            }
        }

        void StopVoice()
        {
            voiceQueue.Clear();
            if (voice != null) voice.Stop();
        }

        void Update()
        {
            if (voice != null && !voice.isPlaying && voiceQueue.Count > 0)
            {
                voice.clip = voiceQueue.Dequeue();
                voice.volume = voiceVolume;
                voice.Play();
            }
        }

        static Line ParseLine(string raw, List<string> tags)
        {
            string speaker = null, speakerId = null, scene = null, paren = null, image = null;
            var transition = false;
            foreach (var t in tags)
            {
                if (t.StartsWith("speaker:")) speaker = speakerId = t.Substring(8).Trim();
                else if (t.StartsWith("scene:")) scene = t.Substring(6).Trim();
                else if (t.StartsWith("paren:")) paren = t.Substring(6).Trim();
                else if (t.StartsWith("image:")) image = t.Substring(6).Trim();
                else if (t == "transition") transition = true;
            }
            var text = raw;
            if (speaker != null)
            {
                var colon = raw.IndexOf(": ", StringComparison.Ordinal);
                if (colon > 0) { speaker = raw.Substring(0, colon); text = raw.Substring(colon + 2); }
            }
            return new Line { Speaker = speaker, SpeakerId = speakerId, Text = text, Tags = tags, Scene = scene, Paren = paren, Image = image, IsTransition = transition };
        }

        // ---- Scene pictures: the first line of a scene may carry #image:<file> ----------------

        static readonly Dictionary<string, Texture2D> pictures = new Dictionary<string, Texture2D>();

        /// <summary>
        /// The picture for an #image file name, or null. Pictures ship as their PNG or JPEG bytes in the package's
        /// Resources (StoryInfo.ImageFolder + file + ".bytes") and are decoded once, then kept.
        /// </summary>
        public static Texture2D LoadPicture(string file)
        {
            if (string.IsNullOrEmpty(file)) return null;
            if (pictures.TryGetValue(file, out var cached) && cached != null) return cached;
            var data = Resources.Load<TextAsset>(StoryInfo.ImageFolder + file);
            if (data == null) return null;
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false) { name = file, wrapMode = TextureWrapMode.Clamp };
            // Keep no CPU copy once it's on the GPU (there is no GPU when the editor runs headless).
            var ok = texture.LoadImage(data.bytes, SystemInfo.graphicsDeviceType != UnityEngine.Rendering.GraphicsDeviceType.Null);
            Resources.UnloadAsset(data);
            if (!ok) return null;
            pictures[file] = texture;
            return texture;
        }

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
                    player.cues.Add(new NarrativeCuePlayer.Cue { name = name, action = NarrativeCuePlayer.Guess(name) });
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
                var dot = file.LastIndexOf('.');
                if (Resources.Load<AudioClip>(StoryInfo.AudioFolder + (dot > 0 ? file.Substring(0, dot) : file)) == null)
                    errors.Add("Voice clip did not import: " + file);
            }
            // And every scene picture and character portrait must decode.
            foreach (var file in picturesSeen)
                if (NarrativeController.LoadPicture(file) == null) errors.Add("Scene picture could not be loaded: " + file);
            foreach (var speaker in StoryInfo.PortraitSpeakers)
                if (NarrativeController.LoadPortrait(speaker) == null) errors.Add("Portrait could not be loaded: " + speaker);
            var carry = SaveCarryOverCheck(errors);
            var startAt = StartAtCheck(errors);
            var exit = ExitCheck(errors);
            var ui = StoryViewCheck(errors);
            var gates = LockedChoiceCheck(json, errors);
            var cueResult = CueCheck(errors);
            var slots = SaveSlotCheck(errors);
            var routeResult = "no playthrough routes";
            if (StoryRoutes.All.Length > 0)
            {
                var routesOk = PlaythroughRunner.RunAll(out var routeLog);
                if (!routesOk) errors.Add(routeLog);
                routeResult = routesOk ? "playthrough routes passed (" + StoryRoutes.All.Length + ")" : "playthrough routes failed";
            }
            log = "[NarrativeBridge] Smoke test (" + source + "): " + clipsHeard.Count + " voice clip(s), " + picturesSeen.Count + " picture(s) and " + StoryInfo.PortraitSpeakers.Length + " portrait(s) checked, " + completed + "/" + runs + " playthroughs reached an ending, "  + carry + ", " + startAt + ", " + exit + ", " + ui + ", " + gates + ", " + cueResult + ", " + slots + ", " + routeResult + ", " + errors.Count + " runtime errors." +
                  (errors.Count > 0 ? "\\n" + string.Join("\\n", errors) : "");
            return errors.Count == 0 && completed > 0;
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
                foreach (var tag in StoryInfo.CueTags)
                {
                    var colon = tag.IndexOf(':');
                    player.Play(colon < 0 ? tag : tag.Substring(0, colon), colon < 0 ? "" : tag.Substring(colon + 1));
                }
                return "cues passed (" + heard.Count + " of " + StoryInfo.Cues.Length + " reached)";
            }
            catch (System.Exception e) { errors.Add("Cue: " + e.Message); return "cues failed"; }
            finally { UnityEngine.Object.DestroyImmediate(go); }
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
                if (!view.SettingsOpen || view.SettingsButtons.Count != 7) { errors.Add("Settings: expected 7 buttons in the menu but it has " + view.SettingsButtons.Count + "."); return null; }
                NarrativeSettings.TextScale = 1f;
                view.SettingsButtons[0].onClick.Invoke(); // text size, one step up
                view.SettingsButtons[3].onClick.Invoke(); // high contrast
                view.Build(); // a playing panel rebuilds itself; in the editor it's done here
                if (Mathf.Abs(NarrativeSettings.TextScale - 1.15f) > 0.01f || NarrativeSettings.HighContrast == contrast) { errors.Add("Settings: the menu's buttons didn't change the settings."); return null; }
                if (!view.SettingsOpen || view.SettingsButtons.Count != 7) { errors.Add("Settings: the menu closed when a setting changed."); return null; }
                view.SettingsButtons[6].onClick.Invoke(); // close
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
