import { useEffect, useRef, useState } from 'react';
import type { Diagnostic } from '../core/diagnostics';
import type { StoryProject } from '../core/isr';
import { attachSmoke, processProject, type ProcessedStory } from '../core/pipeline';
import { smokeTestAsync } from '../core/validate';
// Inlined so the worker also works in the single-file writer edition opened from disk.
import PipelineWorker from './pipeline.worker?worker&inline';

export interface PipelineRequest {
  id: number;
  project: StoryProject;
  parseDiagnostics: Diagnostic[];
}

export interface PipelineResponse {
  id: number;
  processed: ProcessedStory;
}

function startWorker(): Worker | null {
  try {
    return new PipelineWorker();
  } catch {
    return null; // e.g. a browser that blocks workers on file:// pages
  }
}

/**
 * Processes the project in a background worker so typing stays responsive on long scripts.
 * Returns the latest result for the newest project, or null before the first one arrives.
 * Without worker support it does the same work on the page, with playthroughs time-sliced.
 * Sets html[data-pipeline] to "worker" or "page" (handy for tests).
 */
export function useProcessedStory(project: StoryProject | null, parseDiagnostics: Diagnostic[]): { processed: ProcessedStory | null; stale: boolean } {
  const [result, setResult] = useState<{ id: number; processed: ProcessedStory } | null>(null);
  const worker = useRef<Worker | null | undefined>(undefined);
  const nextId = useRef(0);
  const [sentId, setSentId] = useState(0);

  useEffect(() => {
    const w = startWorker();
    worker.current = w;
    document.documentElement.dataset.pipeline = w ? 'worker' : 'page';
    if (!w) return;
    w.onmessage = (e: MessageEvent<PipelineResponse>) => {
      if (e.data.id === nextId.current) setResult(e.data);
    };
    w.onerror = () => {
      // Worker failed to load: fall back to the page for this and later edits.
      worker.current = null;
      document.documentElement.dataset.pipeline = 'page';
      setSentId((n) => n + 1);
    };
    return () => w.terminate();
  }, []);

  useEffect(() => {
    if (!project || worker.current === undefined) return;
    const id = ++nextId.current;
    if (worker.current) {
      worker.current.postMessage({ id, project, parseDiagnostics } satisfies PipelineRequest);
      return;
    }
    // Page fallback.
    const quick = processProject(project, parseDiagnostics, { skipSmoke: true });
    setResult({ id, processed: quick });
    if (!quick.smokePending || !quick.compile.json) return;
    const timer = setTimeout(async () => {
      const r = await smokeTestAsync(quick.compile.json!, project, { shouldContinue: () => id === nextId.current });
      if (r && id === nextId.current) setResult({ id, processed: attachSmoke(quick, r) });
    }, 250);
    return () => clearTimeout(timer);
  }, [project, parseDiagnostics, sentId]);

  const current = result && project ? result.processed : null;
  return { processed: current, stale: !!result && result.id !== nextId.current };
}
