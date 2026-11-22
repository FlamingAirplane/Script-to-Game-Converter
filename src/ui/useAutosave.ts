import { useEffect, useRef, useState } from 'react';
import type { Diagnostic } from '../core/diagnostics';
import type { StoryProject } from '../core/isr';
import { log } from '../core/log';
import { validateSchema } from '../core/schema';
import { sweepUnusedMediaOnce } from './mediaSweep';
import { kvGet, kvSet, storageUse } from './platform';

// Autosave to this browser: IndexedDB (room for large projects), plus a quick copy in localStorage while the project
// is small. If both fail, the writer is told, and must save a project file instead.

const appLog = log('app');

/** The compatibility name of the autosave (see names.test.ts): kept so an earlier version's autosave is still found. */
export const STORAGE_KEY = 'narrative-bridge.project.v1';

export interface Saved {
  project: StoryProject;
  parseDiagnostics: Diagnostic[];
  /** When it was autosaved (ms); the newer of the two autosaved copies wins on start-up. */
  savedAt?: number;
}

export const valid = (s: Saved | null | undefined): s is Saved => !!s?.project && !validateSchema(s.project).some((d) => d.severity === 'error');

/** The quick copy in localStorage (kept while the project is small), read synchronously on start-up. */
export function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = raw ? (JSON.parse(raw) as Saved) : null;
    return valid(s) ? s : null;
  } catch {
    return null;
  }
}

/** Projects larger than this are autosaved to IndexedDB only (localStorage holds about 5 MB in all). */
export const QUICK_COPY_LIMIT = 1_500_000;
/** How long autosave waits for typing to pause (closing or hiding the page saves at once). */
export const AUTOSAVE_DELAY_MS = 500;
/** Browser storage this full (of its quota) is reported as "low". */
export const LOW_STORAGE = 0.85;

export type AutosaveState = 'saved' | 'low' | 'failed' | null;

/** How the last save went: failed when neither copy was kept, low when the browser is nearly out of room. */
export function autosaveState(kept: boolean, use: number | null): Exclude<AutosaveState, null> {
  return !kept ? 'failed' : use !== null && use > LOW_STORAGE ? 'low' : 'saved';
}

/**
 * Keeps the open project in this browser. On start-up a newer autosave in IndexedDB than the quick copy replaces it
 * (`onRestore`), and media no story uses any more is cleared out. Returns how autosave is doing.
 */
export function useAutosave({
  initial,
  project,
  parseDiagnostics,
  onRestore,
}: {
  initial: Saved | null;
  project: StoryProject | null;
  parseDiagnostics: Diagnostic[];
  onRestore: (saved: Saved) => void;
}): AutosaveState {
  const [autosave, setAutosave] = useState<AutosaveState>(initial ? 'saved' : null);
  const loaded = useRef(false);
  useEffect(() => {
    void kvGet<Saved>(STORAGE_KEY)
      .then((s) => {
        if (valid(s) && (!initial || (s.savedAt ?? 0) > (initial.savedAt ?? 0))) {
          onRestore(s);
          setAutosave('saved');
        }
        // Clear out media no story here uses any more; an autosave that can't be read skips it, keeping everything.
        void sweepUnusedMediaOnce(s === undefined || valid(s) ? [s?.project, initial?.project] : null);
      })
      .catch(() => void sweepUnusedMediaOnce(null))
      .finally(() => (loaded.current = true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The latest edit's save, while it waits for typing to pause; run at once if the page is closing.
  const pendingSave = useRef<(() => void) | null>(null);
  useEffect(() => {
    const flush = () => pendingSave.current?.();
    const onHidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  useEffect(() => {
    if (!project || !loaded.current) return;
    // Saved once typing pauses, not on every keystroke: a long story is a large write.
    const save = () => {
      pendingSave.current = null;
      const saved: Saved = { project, parseDiagnostics, savedAt: Date.now() };
      const json = JSON.stringify(saved);
      let quick = false;
      try {
        if (json.length < QUICK_COPY_LIMIT) {
          localStorage.setItem(STORAGE_KEY, json);
          quick = true;
        } else localStorage.removeItem(STORAGE_KEY); // too big: IndexedDB holds the only copy
      } catch {
        /* full: IndexedDB below */
      }
      void kvSet(STORAGE_KEY, saved)
        .then(() => true)
        .catch(() => quick)
        .then(async (ok) => {
          const use = ok ? await storageUse() : null;
          const next = autosaveState(ok, use);
          setAutosave((was) => {
            if (was !== next) {
              if (next === 'failed') appLog.warn('Autosave failed: browser storage is full or unavailable');
              else if (next === 'low') appLog.warn('Browser storage is almost full', { used: Math.round((use ?? 0) * 100) });
              else if (was === 'failed' || was === 'low') appLog.info('Autosave works again');
            }
            return next;
          });
        });
    };
    pendingSave.current = save;
    const timer = setTimeout(save, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [project, parseDiagnostics]);

  // Closing the page while autosave is failing would lose work: let the browser ask first.
  useEffect(() => {
    if (autosave !== 'failed') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [autosave]);

  return autosave;
}
