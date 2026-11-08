// Builds the Unreal export with a real Unreal Engine: exports a sample story as an Unreal project, installs Inkpot
// at the export's pinned ref into its Plugins folder, and compiles the editor target with UnrealBuildTool. With
// --test it then runs the export's automation tests (the playthrough routes and the story component's checks)
// headless in the editor. Unlike `npm run test:unreal` (clang against stand-in headers) this proves the project
// builds, but it needs Unreal Engine and a C++ toolchain, so it isn't part of CI.
//
//   npm run test:unreal:build                                 the archive sample, engine found by itself
//   npm run test:unreal:build -- --sample motel --test        another sample, then its automation tests
//   npm run test:unreal:build -- --engine "D:/UE_5.7"         a particular engine
//   npm run test:unreal:build -- --inkpot path/to/Inkpot      a local Inkpot checkout instead of cloning it
//   npm run test:unreal:build -- --out path/to/folder         where to put the project (default: a temp folder)

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { reviewAll } from '../src/core/adapt';
import { buildStory } from '../src/core/builder';
import { ADAPTERS } from '../src/core/export';
import { processProject } from '../src/core/pipeline';
import { SAMPLES } from '../src/samples';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);
const windows = process.platform === 'win32';
const adapter = ADAPTERS.unreal;

const sample = SAMPLES.find((s) => s.id === (opt('sample') ?? 'archive'));
if (!sample) {
  console.error(`No sample called ${opt('sample')}. Samples: ${SAMPLES.map((s) => s.id).join(', ')}.`);
  process.exit(2);
}

function findEngine(): string | undefined {
  const given = opt('engine');
  if (given) return given;
  const version = adapter.defaultEngineVersion;
  const roots = windows ? ['C:/Program Files/Epic Games', 'D:/Program Files/Epic Games', 'C:/Epic Games', 'D:/Epic Games'] : ['/Users/Shared/Epic Games', join(homedir(), 'UnrealEngine')];
  for (const root of roots) {
    const dir = join(root, `UE_${version}`);
    if (existsSync(join(dir, 'Engine'))) return dir;
  }
  return undefined;
}

const engine = findEngine();
if (!engine) {
  console.error(`Couldn’t find Unreal Engine ${adapter.defaultEngineVersion}. Pass --engine <folder that holds Engine/>.`);
  process.exit(2);
}

const out = resolve(opt('out') ?? mkdtempSync(join(tmpdir(), 'narrative-bridge-unreal-build-')));
const { project } = await buildStory([{ fileName: sample.fileName, text: sample.text }], { mode: sample.mode });
reviewAll(project, 'approved');
const story = processProject(project);
const ref = adapter.integration.defaultRef;
const result = await adapter.export(story, { engine: 'unreal', projectName: sample.id, engineVersion: adapter.defaultEngineVersion, integrationRef: ref, includeDemo: true });
if (result.report.errors.length) {
  console.error(`The export has errors:\n${result.report.errors.join('\n')}`);
  process.exit(1);
}
const name = result.rootName;
const root = join(out, name);
// Keep Intermediate/ and Binaries/ from an earlier run in the same --out folder, so a rebuild is quick.
for (const dir of ['Source', 'Config', 'StorySource', 'Content/NarrativeBridge']) rmSync(join(root, dir), { recursive: true, force: true });
for (const f of result.files) {
  const path = join(out, f.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, f.content);
}

// Inkpot at the pinned ref, as Scripts/setup_inkpot does (a local checkout with --inkpot).
const plugin = join(root, 'Plugins', 'Inkpot');
if (!existsSync(join(plugin, 'Inkpot.uplugin'))) {
  const local = opt('inkpot');
  if (local) cpSync(resolve(local), plugin, { recursive: true, filter: (p) => !/[\\/]\.git([\\/]|$)/.test(p) });
  else {
    const r = spawnSync('git', ['clone', '--depth', '1', '--branch', ref, adapter.integration.repository, plugin], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('Couldn’t clone Inkpot. Pass --inkpot <a local checkout>.');
      process.exit(2);
    }
  }
}

const uproject = join(root, `${name}.uproject`);
const build = windows ? join(engine, 'Engine/Build/BatchFiles/Build.bat') : join(engine, 'Engine/Build/BatchFiles/Mac/Build.sh');
const platform = windows ? 'Win64' : 'Mac';
console.log(`Building ${name}Editor with ${engine} (project in ${root})…`);
const buildArgs = [`${name}Editor`, platform, 'Development', `-Project=${uproject}`, '-WaitMutex', '-NoHotReloadFromIDE'];
// A .bat needs cmd.exe, which wants the whole line quoted once more (the engine is usually under "Program Files").
const b = windows
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', `"${[build, ...buildArgs].map((a) => `"${a}"`).join(' ')}"`], { stdio: 'inherit', windowsVerbatimArguments: true })
  : spawnSync(build, buildArgs, { stdio: 'inherit' });
if (b.status !== 0) {
  console.error(`✗ ${name} doesn’t build (exit code ${b.status}).`);
  process.exit(1);
}
console.log(`✓ ${name} builds with Unreal Engine ${adapter.defaultEngineVersion} and Inkpot ${ref}.`);

if (flag('test')) {
  // The story asset is imported by the tests themselves (see NarrativeBridgeTests.cpp), so nothing needs to be in Content/ first.
  const editor = windows ? join(engine, 'Engine/Binaries/Win64/UnrealEditor-Cmd.exe') : join(engine, 'Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor');
  const log = join(root, 'Saved', 'NarrativeBridgeTests.log');
  console.log('Running the automation tests…');
  const t = spawnSync(editor, [uproject, '-ExecCmds=Automation RunTests NarrativeBridge; Quit', '-unattended', '-nopause', '-nullrhi', '-nosplash', '-NoSound', `-abslog=${log}`, '-TestExit=Automation Test Queue Empty'], { stdio: 'inherit' });
  const saved = join(root, 'Saved', 'Logs');
  console.log(`Log: ${log}${existsSync(saved) ? ` (and ${readdirSync(saved).length} more in ${saved})` : ''}`);
  // Each test's result, from the log (the editor's exit code alone doesn't always say).
  const results = existsSync(log) ? [...readFileSync(log, 'utf8').matchAll(/Test Completed\. Result=\{(\w+)\} Name=\{([^}]*)\} Path=\{([^}]*)\}/g)] : [];
  for (const [, outcome, , path] of results) console.log(`  ${outcome === 'Success' ? '✓' : '✗'} ${path}`);
  const failures = results.filter(([, outcome]) => outcome !== 'Success');
  if (t.status !== 0 || failures.length || results.length === 0) {
    console.error(results.length ? `✗ ${failures.length} of ${results.length} automation tests failed (exit code ${t.status}).` : '✗ No automation tests ran.');
    process.exit(1);
  }
  console.log(`✓ All ${results.length} automation tests pass.`);
}
