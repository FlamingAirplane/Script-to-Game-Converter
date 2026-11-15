// Checks the C++ that changes from story to story in the Unreal export: exports each sample story as an Unreal project
// and compiles its generated headers (NarrativeBridgeStoryInfo.h, with the story's passages, cues and the C++ conditions
// of its locked choices, and NarrativeBridgeRoutes.h, the playthrough routes) with clang, against the stand-in
// CoreMinimal.h in tests/unreal-stubs (syntax and types only, nothing is linked). It runs in CI, which has no Unreal.
//
// The rest of the export's C++ is the same for every story; `npm run test:unreal:build` builds all of it, and runs its
// automation tests, with a real Unreal Engine and Inkpot.
//
//   npm run test:unreal                       every sample
//   npm run test:unreal -- --sample archive   one sample
//   npm run test:unreal -- --cxx clang++-18   a particular compiler

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

// Uses every table, and calls every locked choice's conditions, so their types are checked too.
const CHECK_CPP = `#include "NarrativeBridgeStoryInfo.h"
#include "NarrativeBridgeRoutes.h"

namespace
{
    struct FReader final : NarrativeBridgeStoryInfo::FVariableReader
    {
        bool Has(const TCHAR*) const override { return false; }
        bool CompareNumber(const TCHAR*, const TCHAR*, double) const override { return false; }
        bool CompareText(const TCHAR*, const TCHAR*, const TCHAR*) const override { return false; }
        bool CompareBool(const TCHAR*, const TCHAR*, bool) const override { return false; }
    };
}

int32 CheckStoryInfo()
{
    using namespace NarrativeBridgeStoryInfo;
    int32 N = 0;
    const TCHAR* const* Lists[] = { Passages, PassageTitles, Lines, LineTexts, ItemVariables, Variables, Exits, Cues, CueTags, CueSoundTags, CueSoundFiles, PortraitSpeakers, PortraitFiles, ReservedTags };
    for (const TCHAR* const* List : Lists) N += List[0] ? 1 : 0;
    N += NumPassages + NumLines + NumItemVariables + NumVariables + NumExits + NumCues + NumCueTags + NumCueSoundTags + NumPortraitSpeakers + NumReservedTags;
    const TCHAR* Strings[] = { Title, ProjectId, StoryVersion, SourceLanguage, StoryAssetPath, AudioPackagePath, ThemeFile, TranslationsFile, ImageFolder, SaveFolder, ContinueText, ExitPrefix };
    N += Strings[0] ? 1 : 0;
    const FReader Reader;
    for (int32 i = 0; i < NumGatedChoices; ++i)
    {
        const FGatedChoice& G = GatedChoices[i];
        N += G.bForced ? 1 : 0;
        for (int32 r = 0; r < G.NumRequirements; ++r) N += G.Requirements[r].Test(Reader) ? 1 : 0;
    }
    for (int32 i = 0; i < NarrativeBridgeRoutes::NumRoutes; ++i) N += NarrativeBridgeRoutes::All[i].NumChoices;
    return N;
}
`;

let failed = 0;
for (const sample of samples) {
  const { project } = await buildStory([{ fileName: sample.fileName, text: sample.text }], { mode: sample.mode });
  reviewAll(project, 'approved');
  const story = processProject(project);
  const adapter = ADAPTERS.unreal;
  const result = await adapter.export(story, { engine: 'unreal', projectName: sample.id, engineVersion: adapter.defaultEngineVersion, integrationRef: adapter.integration.defaultRef, includeDemo: true });
  const dir = join(out, sample.id);
  mkdirSync(dir, { recursive: true });
  const headers = result.files.filter((f) => /\/(NarrativeBridgeStoryInfo|NarrativeBridgeRoutes)\.h$/.test(f.path));
  for (const f of headers) writeFileSync(join(dir, f.path.split('/').pop()!), f.content as string);
  writeFileSync(join(dir, 'check.cpp'), CHECK_CPP);
  const r = spawnSync(cxx, ['-std=c++20', '-fsyntax-only', '-Wall', '-Wno-unused-variable', '-Wno-unused-const-variable', '-I', stubs, '-I', dir, join(dir, 'check.cpp')], { encoding: 'utf8' });
  if (r.error) {
    console.error(`Couldn’t run ${cxx}: ${r.error.message}. Install clang, or pass --cxx <compiler>.`);
    process.exit(2);
  }
  const ok = r.status === 0 && headers.length === 2;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${sample.id}: ${headers.map((f) => f.path.split('/').pop()).join(', ')}`);
  if (r.stderr.trim()) console.log(r.stderr.trim());
}
console.log(failed ? `${failed} of ${samples.length} failed.` : `All ${samples.length} compile against the stand-in headers (files in ${out}).`);
process.exit(failed ? 1 : 0);
