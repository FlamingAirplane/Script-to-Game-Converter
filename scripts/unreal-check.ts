// Checks the C++ in the Unreal export: exports each sample story as an Unreal project and compiles its
// story component with clang against the stand-in Unreal and Inkpot headers in tests/unreal-stubs
// (syntax and types only, nothing is linked). It catches mistakes in the generated code; it doesn't prove the
// project builds in Unreal, which needs the real engine.
//
//   npm run test:unreal                       every sample
//   npm run test:unreal -- --sample archive   one sample
//   npm run test:unreal -- --cxx clang++-18   a particular compiler

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
const cxx = opt('cxx') ?? 'clang++';
const stubs = resolve('tests/unreal-stubs');
const samples = opt('sample') ? SAMPLES.filter((s) => s.id === opt('sample')) : SAMPLES;
if (!samples.length) {
  console.error(`No sample called ${opt('sample')}. Samples: ${SAMPLES.map((s) => s.id).join(', ')}.`);
  process.exit(2);
}
const out = mkdtempSync(join(tmpdir(), 'narrative-bridge-unreal-check-'));

let failed = 0;
for (const sample of samples) {
  const { project } = await buildStory([{ fileName: sample.fileName, text: sample.text }], { mode: sample.mode });
  reviewAll(project, 'approved');
  const story = processProject(project);
  const adapter = ADAPTERS.unreal;
  const result = await adapter.export(story, { engine: 'unreal', projectName: sample.id, engineVersion: adapter.defaultEngineVersion, integrationRef: adapter.integration.defaultRef, includeDemo: true });
  const name = result.rootName;
  const sources = result.files.filter((f) => f.path.startsWith(`${name}/Source/${name}/`) && /\.(h|cpp)$/.test(f.path) && !f.path.endsWith(`/${name}.cpp`));
  for (const f of sources) {
    const path = join(out, sample.id, f.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.content as string);
  }
  const moduleDir = join(out, sample.id, name, 'Source', name);
  const cpp = sources.filter((f) => f.path.endsWith('.cpp')).map((f) => join(out, sample.id, f.path));
  const r = spawnSync(cxx, ['-std=c++20', '-fsyntax-only', '-Wall', '-Wno-unused-private-field', `-D${name.toUpperCase()}_API=`, '-I', stubs, '-I', moduleDir, ...cpp], { encoding: 'utf8' });
  if (r.error) {
    console.error(`Couldn’t run ${cxx}: ${r.error.message}. Install clang, or pass --cxx <compiler>.`);
    process.exit(2);
  }
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${sample.id}: ${sources.map((f) => f.path.split('/').pop()).join(', ')}`);
  if (r.stderr.trim()) console.log(r.stderr.trim());
}
console.log(failed ? `${failed} of ${samples.length} failed.` : `All ${samples.length} compile against the stand-in headers (files in ${out}).`);
process.exit(failed ? 1 : 0);
