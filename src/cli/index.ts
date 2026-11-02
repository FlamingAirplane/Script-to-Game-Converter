#!/usr/bin/env -S npx tsx
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { reviewAll } from '../core/adapt';
import { buildStory } from '../core/builder';
import { sortDiagnostics, type Diagnostic } from '../core/diagnostics';
import { ADAPTERS, ExportBlockedError, type EngineTarget } from '../core/export';
import type { ConversionMode, StoryProject } from '../core/isr';
import { processProject } from '../core/pipeline';

const HELP = `Narrative Bridge — screenplays and prose → Ink → Unity / Unreal

Usage:
  narrative-bridge convert <files...> [--mode faithful|adaptation|structured] [--approve-all]
                                      [--out story.ink] [--project story.nbproj.json] [--title "Title"]
  narrative-bridge validate <files... | project.nbproj.json>
  narrative-bridge export <files... | project.nbproj.json> --engine unity|unreal --out <dir>
                                      [--name ProjectName] [--engine-version 2022.3.62f1] [--ref <tag|sha>] [--no-demo]
  narrative-bridge doctor [--engine unity|unreal]

Exit codes: 0 success, 1 validation errors / export blocked, 2 usage error.`;

type Args = { _: string[]; [k: string]: string | boolean | string[] };

function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

const color = (code: number) => (s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = color(31);
const yellow = color(33);
const green = color(32);
const dim = color(2);
const cyan = color(36);

function printDiagnostics(ds: Diagnostic[]) {
  for (const d of sortDiagnostics(ds)) {
    const sev = d.severity === 'error' ? red('error  ') : d.severity === 'warning' ? yellow('warning') : d.severity === 'review' ? cyan('review ') : dim('info   ');
    const where = d.source ? dim(` (line ${d.source.line})`) : d.entityId ? dim(` [${d.entityId}]`) : '';
    console.log(`  ${sev} ${d.code}: ${d.message}${where}`);
    if (d.remediation && d.severity !== 'info') console.log(dim(`          → ${d.remediation}`));
  }
}

async function load(args: Args) {
  const files = args._.slice(1);
  if (!files.length) usage('No input files given.');
  if (files.length === 1 && files[0].endsWith('.nbproj.json')) {
    const project = JSON.parse(readFileSync(files[0], 'utf8')) as StoryProject;
    return processProject(project);
  }
  const inputs = files.map((f) => {
    if (!existsSync(f)) usage(`File not found: ${f}`);
    return { fileName: basename(f), text: readFileSync(f, 'utf8') };
  });
  const mode = (args.mode as ConversionMode) ?? 'faithful';
  if (!['faithful', 'adaptation', 'structured'].includes(mode)) usage(`Unknown mode ${mode}`);
  const { project, diagnostics } = await buildStory(inputs, { mode, title: typeof args.title === 'string' ? args.title : undefined });
  if (args['approve-all']) reviewAll(project, 'approved');
  return processProject(project, diagnostics);
}

function usage(msg?: string): never {
  if (msg) console.error(red(msg) + '\n');
  console.error(HELP);
  process.exit(2);
}

function summary(story: Awaited<ReturnType<typeof load>>) {
  const p = story.project;
  console.log(`${cyan(p.project.title)}  ${dim(`${p.passages.length} passages · ${p.characters.length} characters · ${p.items.length} items · mode ${p.project.mode}`)}`);
  console.log(`State: ${story.state === 'Succeeded' ? green(story.state) : story.state === 'Failed' ? red(story.state) : yellow(story.state)}`);
  if (story.smoke)
    console.log(dim(`Smoke test: ${story.smoke.completedRuns}/${story.smoke.runs} playthroughs reached an ending; endings: ${Object.keys(story.smoke.endingsReached).join(', ') || 'none'}`));
  printDiagnostics(story.diagnostics);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  switch (cmd) {
    case 'convert': {
      const story = await load(args);
      summary(story);
      const out = typeof args.out === 'string' ? args.out : null;
      if (out) {
        writeFileSync(out, story.generated.ink);
        console.log(green(`Wrote ${out}`));
      } else if (!args.project) process.stdout.write('\n' + story.generated.ink);
      if (typeof args.project === 'string') {
        writeFileSync(args.project, JSON.stringify(story.project, null, 2));
        console.log(green(`Wrote ${args.project}`));
      }
      process.exit(story.exportBlocked ? 1 : 0);
    }
    case 'validate': {
      const story = await load(args);
      summary(story);
      process.exit(story.exportBlocked ? 1 : 0);
    }
    case 'export': {
      const engine = args.engine as EngineTarget;
      if (!ADAPTERS[engine]) usage('--engine must be unity or unreal');
      if (typeof args.out !== 'string') usage('--out <dir> is required');
      const adapter = ADAPTERS[engine];
      const story = await load(args);
      summary(story);
      try {
        const result = await adapter.export(story, {
          engine,
          projectName: typeof args.name === 'string' ? args.name : story.project.project.title.replace(/[^\w]+/g, '') || 'NarrativeProject',
          engineVersion: typeof args['engine-version'] === 'string' ? args['engine-version'] : adapter.defaultEngineVersion,
          integrationRef: typeof args.ref === 'string' ? args.ref : adapter.integration.defaultRef,
          includeDemo: !args['no-demo'],
        });
        const outDir = resolve(args.out);
        for (const f of result.files) {
          const target = join(outDir, f.path);
          if (!target.startsWith(outDir)) throw new Error(`Refusing to write outside ${outDir}: ${f.path}`);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, f.content, { mode: f.path.endsWith('.sh') ? 0o755 : 0o644 });
        }
        console.log(green(`\nExported ${result.files.length} files to ${join(outDir, result.rootName)}`));
        printDiagnostics(result.report.diagnostics);
        console.log('\nNext steps:');
        result.report.setupInstructions.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
        process.exit(result.report.errors.length ? 1 : 0);
      } catch (e) {
        if (e instanceof ExportBlockedError) {
          console.error(red(`\nExport blocked — ${e.message}`));
          process.exit(1);
        }
        throw e;
      }
    }
    case 'doctor': {
      const engines = (args.engine ? [args.engine] : ['unity', 'unreal']) as EngineTarget[];
      let missing = 0;
      for (const e of engines) {
        const adapter = ADAPTERS[e];
        console.log(cyan(`\n${adapter.label}`));
        for (const r of adapter.requirements({ engine: e, projectName: 'x', engineVersion: adapter.defaultEngineVersion, integrationRef: adapter.integration.defaultRef, includeDemo: true })) {
          const ok = probe(r.probe);
          if (ok === false) missing++;
          console.log(`  ${ok === true ? green('✔') : ok === false ? red('✘') : yellow('?')} ${r.label}${dim(` — ${r.detail}`)}`);
        }
      }
      process.exit(missing ? 1 : 0);
    }
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      process.exit(0);
    default:
      usage(`Unknown command ${cmd}`);
  }
}

function probe(p?: { command?: string; paths?: string[] }): boolean | null {
  if (!p) return null;
  if (p.paths) {
    const found = p.paths.map((x) => x.replace(/^~/, homedir())).some((x) => existsSync(x));
    if (found || !p.command) return found;
  }
  if (p.command) {
    try {
      execSync(p.command, { stdio: 'ignore', timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
  return null;
}

main().catch((e) => {
  console.error(red(e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exit(1);
});
