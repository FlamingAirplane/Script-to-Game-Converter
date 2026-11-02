/// <reference lib="webworker" />
import { log, logbook, type LogEntry } from '../core/log';
import { attachSmoke, processProject, smokeSummary } from '../core/pipeline';
import { smokeTestAsync } from '../core/validate';
import type { PipelineRequest, WorkerMessage } from './useProcessedStory';

// Runs the pipeline off the main thread. Each request first gets the fast result (analysis, Ink,
// compile); the automated playthroughs follow once edits pause, and are dropped as soon as a newer
// request arrives. Log entries are batched and forwarded to the page's Logbook.

declare const self: DedicatedWorkerGlobalScope;
let latest = 0;
const SETTLE_MS = 250;
const logger = log('worker');

logbook.src = 'worker';
logbook.consoleLevel = 'off';
let pending: LogEntry[] = [];
logbook.subscribe((e) => {
  if (!pending.length) queueMicrotask(flush);
  pending.push(e);
});
function flush() {
  if (!pending.length) return;
  self.postMessage({ type: 'log', entries: pending } satisfies WorkerMessage);
  pending = [];
}

self.onmessage = async (e: MessageEvent<PipelineRequest>) => {
  const { id, project, parseDiagnostics } = e.data;
  latest = id;
  logger.debug('Edit received', { request: id, passages: project.passages.length });
  try {
    const quick = processProject(project, parseDiagnostics, { skipSmoke: true });
    self.postMessage({ type: 'result', id, processed: quick } satisfies WorkerMessage);
    if (!quick.smokePending || !quick.compile.json) return;
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    if (id !== latest) return logger.debug('Playthroughs skipped: a newer edit arrived', { request: id });
    const t = logger.time('Ran automated playthroughs');
    const r = await smokeTestAsync(quick.compile.json, project, { shouldContinue: () => id === latest });
    if (!r || id !== latest) return logger.debug('Playthroughs cancelled: a newer edit arrived', { request: id });
    t(smokeSummary(r.report));
    self.postMessage({ type: 'result', id, processed: attachSmoke(quick, r) } satisfies WorkerMessage);
  } catch (err) {
    logger.error('Processing failed', { request: id, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
    flush();
    throw err;
  }
};
