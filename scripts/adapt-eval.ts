// Scores suggesters against the hand-marked choice moments in tests/adaptation-eval/*.json (see its README).
// One row per suggester set: today's heuristics, the heuristics plus the cheap rules, and, with --suggest model,
// an on-device model alone and with the heuristics. A model ships only if it beats the heuristics here.
//
//   npm run eval:adapt                          the heuristics and the cheap rules (no download)
//   npm run eval:adapt -- --suggest model       also the model; downloads it on first use (hundreds of MB)
//   npm run eval:adapt -- --model <repo> --model-dir <dir> --dtype q4 --revision <rev>
//   npm run eval:adapt -- --held-out            include held-out scripts (a final measurement only)
//   npm run eval:adapt -- --json out.json       also write every number to a file
//   npm run eval:adapt -- --verbose             list each proposal and whether it matched a moment
//   npm run eval:adapt -- --dump                print each script's passages with numbered lines, for annotating

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { heuristicSuggester } from '../src/core/adapt';
import { buildStory, type SourceInput } from '../src/core/builder';
import type { StoryProject } from '../src/core/isr';
import { logbook } from '../src/core/log';
import { BINARY_EXTENSIONS, prepareInput } from '../src/core/parsing/convert';
import { processProject } from '../src/core/pipeline';
import { applyProposals, type Proposal, type ProposalKind, type Suggester } from '../src/core/proposals';
import { cheapRules } from '../src/core/rules';
import { countWords } from '../src/core/stats';
import { SAMPLES } from '../src/samples';

interface Moment { passage: string; line: number; kind: ProposalKind; note?: string }
interface Annotation { script: string; heldOut?: boolean; notes?: string; moments: Moment[] }
interface Row { name: string; suggesters: Suggester[] }

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);
const root = fileURLToPath(new URL('..', import.meta.url));
const EVAL_DIR = join(root, 'tests/adaptation-eval');
logbook.consoleLevel = 'off';

async function loadInput(script: string): Promise<SourceInput> {
  if (script.startsWith('src/samples.ts#')) {
    const id = script.split('#')[1];
    const s = SAMPLES.find((x) => x.id === id);
    if (!s) throw new Error(`No sample "${id}"`);
    return { fileName: s.fileName, text: s.text };
  }
  const path = join(root, script);
  const binary = BINARY_EXTENSIONS.some((e) => path.toLowerCase().endsWith(e));
  return prepareInput(basename(path), binary ? new Uint8Array(readFileSync(path)) : readFileSync(path, 'utf8'));
}

function promptLineNumber(p: StoryProject['passages'][number], contentIndex: number): number {
  // The dump and the model prompt number only action and dialogue lines, from 1.
  let n = 0;
  for (let i = 0; i <= contentIndex; i++) if (p.content[i].type === 'action' || p.content[i].type === 'dialogue') n++;
  return n;
}

function matches(project: StoryProject, proposal: Proposal, m: Moment): boolean {
  const evidencePassage = project.passages.find((p) => p.id === (proposal.evidencePassageId ?? proposal.passageId));
  if (!evidencePassage || proposal.kind !== m.kind) return false;
  if (m.passage !== evidencePassage.id && m.passage !== evidencePassage.sourceId) return false;
  return Math.abs(promptLineNumber(evidencePassage, proposal.evidence) - m.line) <= 1;
}

async function dump(annotations: Annotation[]) {
  for (const a of annotations) {
    const { project } = await buildStory([await loadInput(a.script)], { mode: 'adaptation', heuristics: false });
    console.log(`\n##### ${a.script}  (${project.passages.length} passages; items: ${project.items.map((i) => i.id).join(', ') || 'none'})`);
    for (const p of project.passages) {
      console.log(`--- ${p.id}${p.sourceId ? `  [${p.sourceId}]` : ''}  "${p.title}"  → ${p.divert ?? (p.isEnding ? 'ending' : '')}${p.choices.length ? `  (${p.choices.length} choices already)` : ''}`);
      let n = 0;
      for (const b of p.content) {
        if (b.type !== 'action' && b.type !== 'dialogue') continue;
        n++;
        console.log(`  ${String(n).padStart(2)} [${b.type === 'dialogue' ? b.speakerId : 'action'}] ${b.text.replace(/\s+/g, ' ').slice(0, 100)}`);
      }
    }
  }
}

interface Score {
  name: string;
  scripts: number;
  words: number;
  raw: number;
  valid: number;
  accepted: number;
  byKind: Record<ProposalKind, { valid: number; accepted: number }>;
  momentsTotal: number;
  momentsFound: number;
  completable: number;
  ms: number;
}

async function score(row: Row, annotations: Annotation[], verbose: boolean): Promise<Score> {
  const s: Score = {
    name: row.name, scripts: annotations.length, words: 0, raw: 0, valid: 0, accepted: 0,
    byKind: { pickup: { valid: 0, accepted: 0 }, gate: { valid: 0, accepted: 0 }, reply: { valid: 0, accepted: 0 }, decision: { valid: 0, accepted: 0 } },
    momentsTotal: 0, momentsFound: 0, completable: 0, ms: 0,
  };
  for (const a of annotations) {
    const input = await loadInput(a.script);
    s.words += countWords(input.text);
    const { project } = await buildStory([input], { mode: 'adaptation', heuristics: false });
    s.momentsTotal += a.moments.length;
    const found = new Set<number>();
    if (verbose) console.log(`\n  ${row.name} · ${a.script}`);
    for (const suggester of row.suggesters) {
      const t0 = performance.now();
      const proposals = await suggester.suggest(project);
      const dropped = applyProposals(project, proposals);
      s.ms += performance.now() - t0;
      const droppedAt = new Map(dropped.map((d) => [d.details?.index as number, d]));
      proposals.forEach((proposal, i) => {
        s.raw++;
        const drop = droppedAt.get(i);
        let hit = -1;
        if (!drop) {
          s.valid++;
          s.byKind[proposal.kind].valid++;
          hit = a.moments.findIndex((m) => matches(project, proposal, m));
          if (hit >= 0) {
            s.accepted++;
            s.byKind[proposal.kind].accepted++;
            found.add(hit);
          }
        }
        if (verbose) {
          const where = `${proposal.evidencePassageId ?? proposal.passageId}:${proposal.evidence + 1}`;
          const labels = proposal.choices.map((c) => c.text).join(' / ');
          console.log(`    ${drop ? '✘ dropped ' : hit >= 0 ? '✔ accepted' : '· unmarked'}  ${proposal.kind.padEnd(8)} ${where.padEnd(28)} ${labels}${drop ? `  — ${drop.message}` : ''}`);
        }
      });
    }
    s.momentsFound += found.size;
    if (verbose) for (const [i, m] of a.moments.entries()) if (!found.has(i)) console.log(`    ○ missed    ${m.kind.padEnd(8)} ${`${m.passage}:${m.line}`.padEnd(28)} ${m.note ?? ''}`);
    // Completable: with everything approved, the story still reaches an ending and nothing is left unreachable or ungettable.
    for (const p of project.passages) for (const c of p.choices) if (c.review === 'pending') c.review = 'approved';
    const r = processProject(project, [], { skipSmoke: true });
    if (!r.diagnostics.some((d) => ['NO_REACHABLE_ENDING', 'UNREACHABLE_PASSAGE', 'ALL_CHOICES_CONDITIONAL', 'ITEM_NEVER_ACQUIRED'].includes(d.code) || d.severity === 'error')) s.completable++;
  }
  return s;
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');

function table(scores: Score[]): string {
  const head = ['Suggester', 'Scripts', 'Raw', 'Valid', 'Valid %', 'Accepted', 'Accept %', 'Moments', 'Recall', 'Per script', 'Completable', 'Time'];
  const rows = scores.map((s) => [
    s.name, String(s.scripts), String(s.raw), String(s.valid), pct(s.valid, s.raw), String(s.accepted), pct(s.accepted, s.valid),
    String(s.momentsTotal), pct(s.momentsFound, s.momentsTotal), (s.accepted / Math.max(1, s.scripts)).toFixed(1), `${s.completable}/${s.scripts}`, `${(s.ms / 1000).toFixed(1)}s`,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => `| ${r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join(' | ')} |`;
  return [line(head), `| ${widths.map((w, i) => (i === 0 ? '-'.repeat(w) : `${'-'.repeat(w - 1)}:`)).join(' | ')} |`, ...rows.map(line)].join('\n');
}

async function main() {
  const files = readdirSync(EVAL_DIR).filter((f) => f.endsWith('.json')).sort();
  let annotations: Annotation[] = files.map((f) => JSON.parse(readFileSync(join(EVAL_DIR, f), 'utf8')));
  const heldOut = annotations.filter((a) => a.heldOut).length;
  if (!flag('held-out')) annotations = annotations.filter((a) => !a.heldOut);
  if (flag('dump')) return dump(annotations);

  const rows: Row[] = [
    { name: 'heuristic', suggesters: [heuristicSuggester] },
    { name: 'heuristic + rules', suggesters: [heuristicSuggester, ...cheapRules] },
  ];
  const suggest = opt('suggest') ?? 'heuristic';
  if (suggest === 'model' || suggest === 'all') {
    const { createModelSuggester } = await import('../src/suggest/model');
    const model = createModelSuggester({
      model: opt('model'),
      revision: opt('revision'),
      dtype: opt('dtype'),
      modelDir: opt('model-dir'),
      onDownload: (file, loaded, total) => process.stderr.write(`\r  downloading ${file} ${total ? pct(loaded, total) : ''}   `),
    });
    rows.push({ name: model.id, suggesters: [model] }, { name: `heuristic + ${model.id}`, suggesters: [heuristicSuggester, model] });
  } else if (suggest !== 'heuristic') throw new Error(`--suggest must be heuristic, model or all, not ${suggest}`);

  const scores: Score[] = [];
  for (const row of rows) scores.push(await score(row, annotations, flag('verbose')));
  console.log(`\nAdaptation evaluation · ${annotations.length} scripts, ${scores[0].words} words, ${scores[0].momentsTotal} marked moments${heldOut ? `${flag('held-out') ? ' (including' : ' (not counting'} ${heldOut} held out)` : ''}\n`);
  console.log(table(scores));
  console.log('\nBy kind (valid → accepted):');
  for (const s of scores) console.log(`  ${s.name.padEnd(30)} ${(['pickup', 'gate', 'reply', 'decision'] as ProposalKind[]).map((k) => `${k} ${s.byKind[k].valid}→${s.byKind[k].accepted}`).join('   ')}`);
  console.log('\nValid: passed the six checks in applyProposals. Accepted: matched a marked moment (passage, kind, line ±1). Recall: marked moments found.');
  console.log('Label quality is rated by hand (see tests/adaptation-eval/README.md).');
  const out = opt('json');
  if (out) {
    writeFileSync(out, JSON.stringify({ date: new Date().toISOString().slice(0, 10), scripts: annotations.map((a) => a.script), scores }, null, 2));
    console.log(`\nWrote ${out}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
