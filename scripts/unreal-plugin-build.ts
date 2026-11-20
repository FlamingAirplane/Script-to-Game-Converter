// Builds the NarrativeBridge plugin (the code in every Unreal export) into prebuilt binaries, so a project that uses it
// needs no C++ toolchain. For each engine version it runs RunUAT BuildPlugin for the platform of the machine it runs on,
// then writes NarrativeBridge-<version>-UE<engine>.zip holding the binaries of every platform built so far, so a Mac and
// a Windows machine each add their own and the zip ends up with both (see .github/workflows/unreal-plugin.yml).
//
// It needs Unreal Engine installed for every version asked for, the platform's toolchain, and Inkpot, which the plugin
// depends on. BuildPlugin only sees the engine's own plugins, so Inkpot (without its ThirdParty/ folder, the ~130 MB of
// Inklecate binaries the plugin never uses) is copied into the engine's Plugins folder for the build and removed again.
// Until the Inkpot Lite fork exists this builds against upstream Inkpot at the export's pinned ref.
//
//   npm run build:unreal-plugin                                    the default engine version, this machine's platform
//   npm run build:unreal-plugin -- --engines 5.7,5.8               several versions (each found as UE_<version>)
//   npm run build:unreal-plugin -- --engine-dir 5.7=D:/UE_5.7      where a version is, when it isn't in the usual place
//   npm run build:unreal-plugin -- --inkpot path/to/Inkpot         a local Inkpot checkout instead of cloning it
//   npm run build:unreal-plugin -- --out dist/unreal-plugin        where the builds and zips go
//   npm run build:unreal-plugin -- --zip-only                      only (re)make the zips from the platform builds in --out
//   npm run build:unreal-plugin -- --dry-run                       print what it would do

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import JSZip from 'jszip';
import { reviewAll } from '../src/core/adapt';
import { buildStory } from '../src/core/builder';
import { ADAPTERS } from '../src/core/export';
import { buildPluginCommand, pluginFilesOf, pluginZipName, shipsInPluginZip, type PluginPlatform } from '../src/core/export/unrealPlugin';
import { processProject } from '../src/core/pipeline';
import { GENERATOR_VERSION } from '../src/core/version';
import { SAMPLES } from '../src/samples';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const allOpts = (name: string) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const flag = (name: string) => args.includes(`--${name}`);
const dry = flag('dry-run');
const adapter = ADAPTERS.unreal;
const windows = process.platform === 'win32';
const platform: PluginPlatform = windows ? 'Win64' : 'Mac';
const out = resolve(opt('out') ?? 'dist/unreal-plugin');
const engines = (opt('engines') ?? adapter.defaultEngineVersion).split(',').map((v) => v.trim()).filter(Boolean);
const given = new Map(allOpts('engine-dir').map((s) => s.split('=') as [string, string]));

if (process.platform !== 'win32' && process.platform !== 'darwin' && !flag('zip-only')) {
  console.error('Unreal plugin binaries are built on Windows (Win64) or macOS (Mac).');
  process.exit(2);
}

function findEngine(version: string): string | undefined {
  const dir = given.get(version);
  if (dir) return dir;
  const roots = windows ? ['C:/Program Files/Epic Games', 'D:/Program Files/Epic Games', 'C:/Epic Games', 'D:/Epic Games'] : ['/Users/Shared/Epic Games', join(homedir(), 'UnrealEngine')];
  return roots.map((r) => join(r, `UE_${version}`)).find((d) => existsSync(join(d, 'Engine')));
}

/** Every file under a folder, as paths relative to it with / separators. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p).map((x) => `${e.name}/${x}`) : [e.name];
  });
}

/** The zip: the plugin's sources (from the first platform build) and the binaries of every platform built. */
async function writeZip(engine: string) {
  const builds = ['Win64', 'Mac'].map((p) => ({ p, dir: join(out, engine, p, 'NarrativeBridge') })).filter((b) => existsSync(b.dir));
  if (!builds.length) {
    console.log(`  No builds for ${engine} in ${out}: no zip.`);
    return;
  }
  const zip = new JSZip();
  const seen = new Set<string>();
  for (const b of builds)
    for (const rel of walk(b.dir).filter(shipsInPluginZip)) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      zip.file(`NarrativeBridge/${rel}`, readFileSync(join(b.dir, rel)));
    }
  const file = join(out, pluginZipName(GENERATOR_VERSION, engine));
  if (dry) return console.log(`  [dry run] would write ${file} from ${builds.map((b) => b.p).join(' + ')}`);
  writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`  ✓ ${file} (${builds.map((b) => b.p).join(' + ')}, ${seen.size} files)`);
}

/** Inkpot at the export's pinned ref, without ThirdParty/, in a folder of its own. */
function inkpotSource(): string {
  const dest = join(out, 'work', 'Inkpot');
  if (existsSync(join(dest, 'Inkpot.uplugin'))) return dest;
  if (dry) return dest;
  const local = opt('inkpot');
  mkdirSync(dirname(dest), { recursive: true });
  if (local) cpSync(resolve(local), dest, { recursive: true, filter: (p) => !/[\\/]\.git([\\/]|$)/.test(p) });
  else {
    const r = spawnSync('git', ['clone', '--depth', '1', '--branch', adapter.integration.defaultRef, adapter.integration.repository, dest], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('Couldn’t clone Inkpot. Pass --inkpot <a local checkout>.');
      process.exit(2);
    }
  }
  rmSync(join(dest, '.git'), { recursive: true, force: true });
  rmSync(join(dest, 'Source', 'ThirdParty'), { recursive: true, force: true });
  rmSync(join(dest, 'ThirdParty'), { recursive: true, force: true });
  return dest;
}

/** The plugin's files, from an export of any sample (it is the same for every story), in a folder outside any project. */
async function writePluginSource(): Promise<string> {
  const sample = SAMPLES[0];
  const { project } = await buildStory([{ fileName: sample.fileName, text: sample.text }], { mode: sample.mode });
  reviewAll(project, 'approved');
  const result = await adapter.export(processProject(project), { engine: 'unreal', projectName: sample.id, engineVersion: adapter.defaultEngineVersion, integrationRef: adapter.integration.defaultRef, includeDemo: true });
  const dir = join(out, 'work', 'NarrativeBridge');
  if (dry) return dir;
  rmSync(dir, { recursive: true, force: true });
  for (const f of pluginFilesOf(result)) {
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.content);
  }
  return dir;
}

if (!flag('zip-only')) {
  const source = await writePluginSource();
  const inkpot = inkpotSource();
  for (const engine of engines) {
    const engineDir = findEngine(engine);
    if (!engineDir) {
      console.error(`Couldn’t find Unreal Engine ${engine}. Pass --engine-dir ${engine}=<folder that holds Engine/>.`);
      process.exit(2);
    }
    const packageDir = join(out, engine, platform, 'NarrativeBridge');
    const { command, args: uatArgs } = buildPluginCommand({ engineDir, platform, uplugin: join(source, 'NarrativeBridge.uplugin'), packageDir });
    console.log(`UE ${engine} (${platform}): ${command} ${uatArgs.join(' ')}`);
    if (dry) continue;
    rmSync(join(out, engine, platform), { recursive: true, force: true });
    // BuildPlugin sees only the engine's plugins, so Inkpot goes in the engine for the build.
    const installed = join(engineDir, 'Engine', 'Plugins', 'Marketplace', 'Inkpot');
    const alreadyThere = existsSync(installed);
    if (!alreadyThere) cpSync(inkpot, installed, { recursive: true });
    try {
      // A .bat needs cmd.exe, which wants the whole line quoted once more (the engine is usually under "Program Files").
      const r = windows
        ? spawnSync('cmd.exe', ['/d', '/s', '/c', `"${[command, ...uatArgs].map((a) => `"${a}"`).join(' ')}"`], { stdio: 'inherit', windowsVerbatimArguments: true })
        : spawnSync(command, uatArgs, { stdio: 'inherit' });
      if (r.status !== 0) {
        console.error(`✗ BuildPlugin failed for UE ${engine} on ${platform} (exit code ${r.status}).`);
        process.exit(1);
      }
    } finally {
      if (!alreadyThere) rmSync(installed, { recursive: true, force: true });
    }
    const binaries = existsSync(packageDir) ? walk(packageDir).filter((f) => f.startsWith('Binaries/')) : [];
    if (!binaries.length) {
      console.error(`✗ BuildPlugin finished but ${relative(process.cwd(), packageDir)} has no Binaries/.`);
      process.exit(1);
    }
    console.log(`✓ UE ${engine} ${platform}: ${binaries.length} binary files`);
    statSync(packageDir);
  }
}
mkdirSync(out, { recursive: true });
for (const engine of engines) await writeZip(engine);
