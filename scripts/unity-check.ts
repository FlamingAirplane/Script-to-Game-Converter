// Checks the Unity export in a real Unity editor, headless: exports the sample stories as complete Unity
// projects, runs each one's smoke test, then its Test Runner tests (the playthrough routes in Edit Mode, the
// story running in Play Mode). Needs Unity 2022.3 or later installed (Unity Hub's default folder, or --unity).
//
//   npm run test:unity                       every sample, Unity from Unity Hub
//   npm run test:unity -- --sample archive   one sample
//   npm run test:unity -- --addressables     media loaded with Addressables
//   npm run test:unity -- --ink <folder>     a local Ink Unity Integration checkout (no git download)
//   npm run test:unity -- --unity <path>     a particular Unity executable
//   npm run test:unity -- --out <folder>     where the projects go (kept, so later runs reuse Unity's cache)
//   npm run test:unity -- --export-only --version 6000.3.28f1
//                                            only write the projects (for CI, which runs Unity itself)

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

function findUnity(): string | null {
  const given = opt('unity');
  if (given) return given;
  const hubs = ['/Applications/Unity/Hub/Editor', 'C:\\Program Files\\Unity\\Hub\\Editor', join(process.env.HOME ?? '', 'Unity/Hub/Editor')];
  for (const hub of hubs) {
    if (!existsSync(hub)) continue;
    const versions = readdirSync(hub).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const v of versions.reverse()) {
      for (const exe of ['Unity.app/Contents/MacOS/Unity', 'Editor/Unity.exe', 'Editor/Unity']) if (existsSync(join(hub, v, exe))) return join(hub, v, exe);
    }
  }
  return null;
}

const exportOnly = flag('export-only');
const unity = exportOnly ? null : findUnity();
if (!unity && !exportOnly) {
  console.error('Unity isn’t installed where Unity Hub puts it. Pass --unity <path to the Unity executable>.');
  process.exit(2);
}
const version = opt('version') ?? (unity && /Editor\/([^/\\]+)[/\\]/.exec(unity.replace(/\\/g, '/') + '/')?.[1]) ?? '6000.3.23f1';
const out = resolve(opt('out') ?? join(tmpdir(), 'narrative-bridge-unity-check'));
const ink = opt('ink');
const samples = opt('sample') ? SAMPLES.filter((s) => s.id === opt('sample')) : SAMPLES;
if (!samples.length) {
  console.error(`No sample called ${opt('sample')}. Samples: ${SAMPLES.map((s) => s.id).join(', ')}.`);
  process.exit(2);
}

function run(project: string, extra: string[], log: string): number {
  const r = spawnSync(unity!, ['-batchmode', '-nographics', '-projectPath', project, ...extra, '-logFile', log], { stdio: 'ignore', timeout: 20 * 60_000 });
  return r.status ?? 1;
}

function testSummary(xml: string): { passed: number; failed: number; skipped: number; failures: string[] } {
  const run = /<test-run[^>]*passed="(\d+)"[^>]*failed="(\d+)"[^>]*skipped="(\d+)"/.exec(xml) ?? /<test-run[^>]*failed="(\d+)"/.exec(xml);
  const failures = [...xml.matchAll(/<test-case [^>]*name="([^"]+)"[^>]*result="Failed"[\s\S]*?<message><!\[CDATA\[([\s\S]*?)\]\]><\/message>/g)].map((m) => `${m[1]}: ${m[2].trim()}`);
  return run && run.length === 4 ? { passed: +run[1], failed: +run[2], skipped: +run[3], failures } : { passed: 0, failed: failures.length || 1, skipped: 0, failures };
}

let failed = false;
for (const sample of samples) {
  const { project } = await buildStory([{ fileName: sample.fileName, text: sample.text }], { mode: sample.mode });
  reviewAll(project, 'approved');
  const story = processProject(project);
  const result = await ADAPTERS.unity.export(story, {
    engine: 'unity',
    projectName: `NB${sample.id[0].toUpperCase()}${sample.id.slice(1)}`,
    engineVersion: version,
    integrationRef: ADAPTERS.unity.integration.defaultRef,
    includeDemo: true,
    unityLayout: 'project',
    unityAddressables: flag('addressables'),
  });
  if (result.report.errors.length) {
    console.log(`✗ ${sample.name}: the export failed: ${result.report.errors.join('; ')}`);
    failed = true;
    continue;
  }
  const root = join(out, result.rootName);
  // Keep Library (Unity's import cache) between runs; replace everything else.
  for (const d of ['Packages', 'Assets', 'ProjectSettings']) rmSync(join(root, d), { recursive: true, force: true });
  for (const f of result.files) {
    const p = join(out, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
  }
  if (ink) {
    const manifest = join(root, 'Packages/manifest.json');
    const m = JSON.parse(readFileSync(manifest, 'utf8'));
    m.dependencies['com.inkle.ink-unity-integration'] = `file:${resolve(ink)}`;
    writeFileSync(manifest, JSON.stringify(m, null, 2));
  }
  if (exportOnly) {
    console.log(`${sample.id}\t${root}`);
    continue;
  }
  const ns = result.unityPackage!.namespace;
  const lines: string[] = [];
  // 1. The smoke test (exit 132 can happen at shutdown after the result is logged, so read the log).
  run(root, ['-executeMethod', `${ns}.EditorTools.NarrativeBridgeEditor.RunSmokeTestBatch`], join(root, 'smoke.log'));
  const smoke = readFileSync(join(root, 'smoke.log'), 'utf8');
  const compileErrors = [...new Set(smoke.match(/^.*(error CS\d+|Assembly has duplicate|has compile errors).*$/gm) ?? [])];
  if (!compileErrors.length && /Scripts have compiler errors/.test(smoke)) compileErrors.push('Scripts have compiler errors (see ' + join(root, 'smoke.log') + ')');
  const line = /\[NarrativeBridge\] Smoke test[^\n]*/.exec(smoke)?.[0];
  // (Unity on Windows ends its log lines with \r.)
  const smokeOk = !!line && / 0 runtime errors\.\s*$/.test(line) && !compileErrors.length;
  lines.push(`  smoke test: ${smokeOk ? 'passed' : 'FAILED'}${line ? `\n    ${line.replace('[NarrativeBridge] ', '')}` : ''}`);
  if (compileErrors.length) lines.push(...compileErrors.slice(0, 8).map((e) => `    ${e}`));
  if (!smokeOk && line) lines.push(...(smoke.slice(smoke.indexOf(line) + line.length).split('\n').slice(1, 6).filter((l) => l.trim() && !/^UnityEngine\./.test(l)).map((l) => `    ${l}`)));
  // 2. The Test Runner: playthrough routes (Edit Mode) and the story in Play Mode.
  let testsOk = true;
  if (!compileErrors.length)
    for (const platform of ['EditMode', 'PlayMode']) {
      const xml = join(root, `${platform}.xml`);
      rmSync(xml, { force: true });
      run(root, ['-runTests', '-testPlatform', platform, '-testResults', xml], join(root, `${platform}.log`));
      const r = existsSync(xml) ? testSummary(readFileSync(xml, 'utf8')) : { passed: 0, failed: 1, skipped: 0, failures: [`no results (see ${join(root, `${platform}.log`)})`] };
      testsOk &&= r.failed === 0;
      lines.push(`  ${platform} tests: ${r.passed} passed, ${r.failed} failed${r.skipped ? `, ${r.skipped} skipped` : ''}`);
      lines.push(...r.failures.map((f) => `    ${f}`));
    }
  const ok = smokeOk && testsOk;
  failed ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${sample.name} (Unity ${version}${flag('addressables') ? ', Addressables' : ''})\n${lines.join('\n')}`);
}
if (!exportOnly) console.log(failed ? '\nSome Unity checks failed.' : '\n✓ Every Unity check passed.');
process.exit(failed ? 1 : 0);
