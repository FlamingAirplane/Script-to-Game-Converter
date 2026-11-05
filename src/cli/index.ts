#!/usr/bin/env -S npx tsx
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewAll } from '../core/adapt';
import { buildStory } from '../core/builder';
import { sortDiagnostics, type Diagnostic } from '../core/diagnostics';
import { ADAPTERS, buildPlayableHtml, buildRecordingScript, recordingScriptFileName, buildTwee, ExportBlockedError, playableFileName, twineFileName, type EngineTarget } from '../core/export';
import type { ConversionMode, StoryProject } from '../core/isr';
import { base64ToBytes, type AudioAssets } from '../core/audio';
import { BINARY_EXTENSIONS, prepareInput } from '../core/parsing/convert';
import { formatEntry, LEVELS, log, logbook, type LogLevel } from '../core/log';
import { processProject } from '../core/pipeline';

const HELP = `Narrative Bridge — screenplays and prose → Ink → Unity / Unreal

Usage:
  narrative-bridge convert <files...>          (.fountain .txt .md .fdx .docx .pdf, or a story: .ink .twee .tw .html) [--mode faithful|adaptation|structured] [--approve-all]
                                      [--edit-ink | --keep-ink]  (Ink: make it editable, or keep it exactly as written;
                                       default: editable unless it uses Ink the editor can't show)
                                      [--out story.ink] [--project story.nbproj.json] [--title "Title"]
  narrative-bridge validate <files... | project.nbproj.json>
  narrative-bridge export <files... | project.nbproj.json> --engine unity|unreal|web|twine|script --out <dir>
                                      [--name ProjectName] [--engine-version 2022.3.62f1] [--ref <tag|sha>] [--no-demo]
                                      Unity: a package for an existing game; [--unity-project] for a new project, [--package-version 1.0.0]
                                      [--story-only]  (twine: just passages, text and links; no code, styling or variables)
  narrative-bridge doctor [--engine unity|unreal]

Logging (to stderr): --verbose shows everything, --quiet only errors, --log-file <path> writes JSON lines.

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

const audioAssets: AudioAssets = {};

async function load(args: Args) {
  const files = args._.slice(1);
  if (!files.length) usage('No input files given.');
  if (files.length === 1 && files[0].endsWith('.nbproj.json')) {
    const data = JSON.parse(readFileSync(files[0], 'utf8'));
    const project = (data.project?.schemaVersion ? data.project : data) as StoryProject;
    // Voice clips saved inside the project file travel into exports.
    for (const [id, c] of Object.entries((data.audio ?? {}) as Record<string, { mime: string; data: string }>)) audioAssets[id] = { mime: c.mime, bytes: base64ToBytes(c.data) };
    return processProject(project, data.parseDiagnostics ?? []);
  }
  const inputs = await Promise.all(
    files.map(async (f) => {
      if (!existsSync(f)) usage(`File not found: ${f}`);
      const binary = BINARY_EXTENSIONS.some((e) => f.toLowerCase().endsWith(e));
      const input = await prepareInput(basename(f), binary ? new Uint8Array(readFileSync(f)) : readFileSync(f, 'utf8'));
      // A converted file (Word, PDF…) goes into exports as it is too.
      if (input.original && input.originalBytes) audioAssets[input.original.id] = { mime: input.original.mime, bytes: input.originalBytes };
      return input;
    }),
  );
  // Ink: editable when possible unless told otherwise (see SourceInput.inkMode).
  const inkMode = args['keep-ink'] ? 'keep' : args['edit-ink'] ? 'edit' : undefined;
  if (inkMode) for (const i of inputs) if (/\.ink$/i.test(i.fileName)) i.inkMode = inkMode;
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

/**
 * Logging: entries go to stderr (so they never mix with Ink printed to stdout) at warn+ by default,
 * everything with --verbose, errors only with --quiet; --log-file writes every entry as JSON lines.
 */
function setUpLogging(args: Args) {
  logbook.src = 'cli';
  logbook.consoleLevel = 'off';
  const min: LogLevel = args.verbose ? 'debug' : args.quiet ? 'error' : 'warn';
  logbook.subscribe((e) => {
    if (LEVELS[e.level] >= LEVELS[min]) process.stderr.write(`${dim(formatEntry(e))}\n`);
  });
  if (typeof args['log-file'] === 'string') {
    const file = resolve(args['log-file']);
    process.on('exit', () => writeFileSync(file, logbook.all().map((e) => JSON.stringify(e)).join('\n') + '\n'));
  }
  log('cli').debug('Command', { command: args._[0], files: args._.length - 1, mode: args.mode, engine: args.engine });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  setUpLogging(args);
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
      const engine = args.engine as EngineTarget | 'web' | 'twine' | 'script';
      if (typeof args.out !== 'string') usage('--out <dir> is required');
      if (engine === 'web' || engine === 'twine' || engine === 'script') {
        // Single-file exports that need no game engine.
        const story = await load(args);
        summary(story);
        try {
          const runtime = () => readFileSync(fileURLToPath(new URL('../../node_modules/inkjs/dist/ink.js', import.meta.url)), 'utf8');
          const [name, content] =
            engine === 'web'
              ? [playableFileName(story), buildPlayableHtml(story, runtime(), audioAssets)]
              : engine === 'script'
                ? [recordingScriptFileName(story.project), buildRecordingScript(story.project)]
                : [twineFileName(story, args['story-only'] ? 'plain' : 'sugarcube'), buildTwee(story, args['story-only'] ? 'plain' : 'sugarcube')];
          const outDir = resolve(args.out);
          mkdirSync(outDir, { recursive: true });
          writeFileSync(join(outDir, name), content);
          console.log(green(`\nWrote ${join(outDir, name)}`));
          process.exit(0);
        } catch (e) {
          if (e instanceof ExportBlockedError) {
            console.error(red(`\nExport blocked — ${e.message}`));
            process.exit(1);
          }
          throw e;
        }
      }
      if (!ADAPTERS[engine]) usage('--engine must be unity, unreal, web, twine or script');
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
          // Unity: a package for an existing game (default), or --unity-project for a complete new project.
          unityLayout: args['unity-project'] ? 'project' : 'package',
          packageVersion: typeof args['package-version'] === 'string' ? args['package-version'] : undefined,
          audio: audioAssets,
          originals: audioAssets,
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
