/// <reference lib="webworker" />
import { attachSmoke, processProject } from '../core/pipeline';
import { smokeTestAsync } from '../core/validate';
import type { PipelineRequest, PipelineResponse } from './useProcessedStory';

// Runs the pipeline off the main thread. Each request first gets the fast result (analysis, Ink,
// compile); the automated playthroughs follow once edits pause, and are dropped as soon as a newer
// request arrives.

declare const self: DedicatedWorkerGlobalScope;
let latest = 0;
const SETTLE_MS = 250;

self.onmessage = async (e: MessageEvent<PipelineRequest>) => {
  const { id, project, parseDiagnostics } = e.data;
  latest = id;
  const quick = processProject(project, parseDiagnostics, { skipSmoke: true });
  self.postMessage({ id, processed: quick } satisfies PipelineResponse);
  if (!quick.smokePending || !quick.compile.json) return;
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  if (id !== latest) return;
  const r = await smokeTestAsync(quick.compile.json, project, { shouldContinue: () => id === latest });
  if (r && id === latest) self.postMessage({ id, processed: attachSmoke(quick, r) } satisfies PipelineResponse);
};
