// Checks the C++ that changes from story to story in the Unreal export: exports each sample story as an Unreal project
// and compiles its generated headers (NarrativeBridgeStoryInfo.h, with the story's passages, cues and the C++ conditions
// of its locked choices, and NarrativeBridgeRoutes.h, the playthrough routes) with clang, against the stand-in
// CoreMinimal.h in tests/unreal-stubs (syntax and types only, nothing is linked). It runs in CI, which has no Unreal.
//
// It also checks the Ink runtime boundary: only the NarrativeBridgeInk* files may include Inkpot or InkPlusPlus headers.
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
import { boundaryViolations } from '../src/core/export/unrealBoundary';
import { conditionCases, storyInfoData, type StoryValue } from '../src/core/export/unrealStoryData';
import type { Condition } from '../src/core/isr';
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

const wide = (v: string) => `TEXT(${JSON.stringify(v)})`;
/** A condition as C++ that builds the FNarrativeCondition tree (the runtime builds the same tree from StoryInfo.json). */
function treeCpp(c: Condition): string {
  switch (c.type) {
    case 'has_item':
      return `HasItem(${wide(`has_${c.itemId}`)})`;
    case 'not':
      return `Negate(${treeCpp(c.condition)})`;
    case 'and':
      return `Many(FNarrativeCondition::EKind::And, { ${c.conditions.map(treeCpp).join(', ')} })`;
    case 'or':
      return `Many(FNarrativeCondition::EKind::Or, { ${c.conditions.map(treeCpp).join(', ')} })`;
    case 'compare':
      return typeof c.value === 'string' ? `CompareText(${wide(c.variableId)}, ${wide(c.op)}, ${wide(c.value)})` : typeof c.value === 'boolean' ? `CompareBool(${wide(c.variableId)}, ${wide(c.op)}, ${c.value})` : `CompareNumber(${wide(c.variableId)}, ${wide(c.op)}, ${c.value})`;
  }
}
const valueCpp = (v: StoryValue) => (typeof v === 'string' ? `V::Text(${wide(v)})` : typeof v === 'boolean' ? `V::Bool(${v})` : `V::Number(${v})`);

/**
 * A program that builds each locked choice's condition tree, runs the C++ evaluator over the sample variable values
 * and compares with what the TypeScript evaluator (conditionHolds) says. It reads variables the way the story component does.
 */
function parityCpp(conditions: { label: string; condition: Condition }[]): { source: string; cases: number } {
  let cases = 0;
  const body = conditions.map(({ label, condition }) => {
    const cs = conditionCases(condition);
    cases += cs.length;
    return `    {\n        const FNarrativeCondition C = ${treeCpp(condition)};\n${cs.map((c) => `        Expect(C, { ${Object.entries(c.vars).map(([k, v]) => `{ ${wide(k)}, ${valueCpp(v)} }`).join(', ')} }, ${c.holds}, ${wide(label)});`).join('\n')}\n    }`;
  });
  return { source: PARITY_CPP.replace('/*CASES*/', body.join('\n')), cases };
}

/** Conditions the samples don't have: every operator, every value type, and nesting. */
const SYNTHETIC: { label: string; condition: Condition }[] = (() => {
  const ops = ['==', '!=', '<', '<=', '>', '>='] as const;
  const out: { label: string; condition: Condition }[] = ops.map((op) => ({ label: `trust ${op} 2`, condition: { type: 'compare', variableId: 'trust', op, value: 2 } }));
  out.push({ label: 'name == "Mara"', condition: { type: 'compare', variableId: 'name', op: '==', value: 'Mara' } });
  out.push({ label: 'name != "Mara"', condition: { type: 'compare', variableId: 'name', op: '!=', value: 'Mara' } });
  out.push({ label: 'met == true', condition: { type: 'compare', variableId: 'met', op: '==', value: true } });
  out.push({ label: 'met != false', condition: { type: 'compare', variableId: 'met', op: '!=', value: false } });
  out.push({ label: 'not has key', condition: { type: 'not', condition: { type: 'has_item', itemId: 'key' } } });
  out.push({ label: 'and()', condition: { type: 'and', conditions: [] } });
  out.push({ label: 'or()', condition: { type: 'or', conditions: [] } });
  out.push({
    label: 'key and (lamp or trust >= 3) and not met',
    condition: { type: 'and', conditions: [{ type: 'has_item', itemId: 'key' }, { type: 'or', conditions: [{ type: 'has_item', itemId: 'lamp' }, { type: 'compare', variableId: 'trust', op: '>=', value: 3 }] }, { type: 'not', condition: { type: 'compare', variableId: 'met', op: '==', value: true } }] },
  });
  return out;
})();

const PARITY_CPP = `#include "NarrativeBridgeCondition.h"
#include <cstdio>
#include <map>
#include <string>
#include <vector>

namespace
{
    struct V
    {
        enum { kNumber, kText, kBool } Kind = kNumber;
        double N = 0;
        std::wstring S;
        bool B = false;
        static V Number(double n) { V v; v.Kind = kNumber; v.N = n; return v; }
        static V Text(const TCHAR* s) { V v; v.Kind = kText; v.S = s; return v; }
        static V Bool(bool b) { V v; v.Kind = kBool; v.B = b; return v; }
    };

    bool Ordered(const std::wstring& Op, int C)
    {
        if (Op == L"==") return C == 0;
        if (Op == L"!=") return C != 0;
        if (Op == L"<") return C < 0;
        if (Op == L"<=") return C <= 0;
        if (Op == L">") return C > 0;
        if (Op == L">=") return C >= 0;
        return false;
    }

    /** The same comparisons the story component makes when it reads ink's variables. */
    struct FMapReader final : FNarrativeVariableReader
    {
        std::map<std::wstring, V> Vars;
        const V* Find(const TCHAR* N) const { auto It = Vars.find(N); return It == Vars.end() ? nullptr : &It->second; }
        bool Has(const TCHAR* N) const override { const V* X = Find(N); return X && (X->Kind == V::kBool ? X->B : X->Kind == V::kNumber ? X->N != 0 : false); }
        bool CompareNumber(const TCHAR* N, const TCHAR* Op, double Value) const override
        {
            const V* X = Find(N);
            const std::wstring O = Op;
            if (!X) return O == L"!=";
            if (X->Kind == V::kBool) return O == L"==" ? X->B == (Value != 0) : O == L"!=" ? X->B != (Value != 0) : false;
            if (X->Kind != V::kNumber) return O == L"!=";
            return Ordered(O, X->N < Value ? -1 : X->N > Value ? 1 : 0);
        }
        bool CompareText(const TCHAR* N, const TCHAR* Op, const TCHAR* Value) const override
        {
            const V* X = Find(N);
            const std::wstring O = Op;
            if (!X || X->Kind != V::kText) return O == L"!=";
            return Ordered(O, X->S.compare(Value));
        }
        bool CompareBool(const TCHAR* N, const TCHAR* Op, bool Value) const override
        {
            const bool B = Has(N);
            const std::wstring O = Op;
            return O == L"==" ? B == Value : O == L"!=" ? B != Value : false;
        }
    };

    int Failures = 0;
    int Checked = 0;

    void Expect(const FNarrativeCondition& C, std::vector<std::pair<const TCHAR*, V>> Vars, bool Wanted, const TCHAR* Where)
    {
        FMapReader R;
        for (const auto& P : Vars) R.Vars[P.first] = P.second;
        ++Checked;
        if (C.Evaluate(R) != Wanted)
        {
            ++Failures;
            std::wprintf(L"  mismatch in %ls: wanted %d\\n", Where, (int)Wanted);
        }
    }

    FNarrativeCondition HasItem(const TCHAR* Var) { FNarrativeCondition C; C.Kind = FNarrativeCondition::EKind::HasItem; C.Variable = Var; return C; }
    FNarrativeCondition Negate(FNarrativeCondition Inner) { FNarrativeCondition C; C.Kind = FNarrativeCondition::EKind::Not; C.Children.Add(Inner); return C; }
    FNarrativeCondition Many(FNarrativeCondition::EKind Kind, std::vector<FNarrativeCondition> Items) { FNarrativeCondition C; C.Kind = Kind; for (const auto& I : Items) C.Children.Add(I); return C; }
    FNarrativeCondition CompareNumber(const TCHAR* Var, const TCHAR* Op, double N) { FNarrativeCondition C; C.Kind = FNarrativeCondition::EKind::Compare; C.Variable = Var; C.Op = Op; C.Operand = FNarrativeCondition::EOperand::Number; C.Number = N; return C; }
    FNarrativeCondition CompareText(const TCHAR* Var, const TCHAR* Op, const TCHAR* S) { FNarrativeCondition C; C.Kind = FNarrativeCondition::EKind::Compare; C.Variable = Var; C.Op = Op; C.Operand = FNarrativeCondition::EOperand::Text; C.Text = S; return C; }
    FNarrativeCondition CompareBool(const TCHAR* Var, const TCHAR* Op, bool B) { FNarrativeCondition C; C.Kind = FNarrativeCondition::EKind::Compare; C.Variable = Var; C.Op = Op; C.Operand = FNarrativeCondition::EOperand::Bool; C.bBool = B; return C; }
}

int main()
{
/*CASES*/
    std::wprintf(L"  %d condition cases checked, %d mismatches\\n", Checked, Failures);
    return Failures ? 1 : 0;
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
  const headers = result.files.filter((f) => /\/(NarrativeBridgeStoryInfo|NarrativeBridgeRoutes|NarrativeBridgeCondition)\.h$/.test(f.path));
  for (const f of headers) writeFileSync(join(dir, f.path.split('/').pop()!), f.content as string);
  writeFileSync(join(dir, 'check.cpp'), CHECK_CPP);
  const r = spawnSync(cxx, ['-std=c++20', '-fsyntax-only', '-Wall', '-Wno-unused-variable', '-Wno-unused-const-variable', '-I', stubs, '-I', dir, join(dir, 'check.cpp')], { encoding: 'utf8' });
  if (r.error) {
    console.error(`Couldn’t run ${cxx}: ${r.error.message}. Install clang, or pass --cxx <compiler>.`);
    process.exit(2);
  }
  // Build and run the evaluator against the TypeScript one's answers.
  const parity = parityCpp([...storyInfoData(story).gatedChoices.flatMap((g, gi) => g.requirements.map((r, ri) => ({ label: `${g.passage} / choice ${gi} / requirement ${ri}`, condition: r.condition }))), ...SYNTHETIC]);
  writeFileSync(join(dir, 'parity.cpp'), parity.source);
  const built = spawnSync(cxx, ['-std=c++20', '-Wall', '-Wno-unused-variable', '-Wno-unused-function', '-I', stubs, '-I', dir, join(dir, 'parity.cpp'), '-o', join(dir, 'parity')], { encoding: 'utf8' });
  const ran = built.status === 0 ? spawnSync(join(dir, 'parity'), [], { encoding: 'utf8' }) : built;
  const leaks = boundaryViolations(result.files);
  const ok = r.status === 0 && ran.status === 0 && headers.length === 3 && leaks.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${sample.id}: ${headers.map((f) => f.path.split('/').pop()).join(', ')}`);
  for (const l of leaks) console.log(l);
  if (ran.status !== 0) console.log(`${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim());
  else console.log(`  ${parity.cases} condition cases agree with the TypeScript evaluator`);
  if (r.stderr.trim()) console.log(r.stderr.trim());
}
console.log(failed ? `${failed} of ${samples.length} failed.` : `All ${samples.length} compile against the stand-in headers (files in ${out}).`);
process.exit(failed ? 1 : 0);
