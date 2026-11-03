import type { Diagnostic } from '../core/diagnostics';
import type { StoryProject } from '../core/isr';
import { errorData, log } from '../core/log';
import { storyStats } from '../core/stats';

// Drafts: named copies of a project kept in this browser (IndexedDB, since projects with their
// sources can outgrow localStorage). Writers keep one before a big change, and one is kept
// automatically before a project is replaced or restored, so earlier work is never lost.
// Voice clips are stored separately by id (see audioStore.ts) and are never deleted with a project,
// so a restored draft still plays its clips.

const draftLog = log('drafts');
const DB = 'narrative-bridge-drafts';
const STORE = 'drafts';
/** Oldest drafts beyond this many are removed (automatic ones first). */
const KEEP = 40;

export interface Draft {
  id: number;
  projectId: string;
  title: string;
  label: string;
  /** True for drafts the app kept by itself (before replacing or restoring a project). */
  auto: boolean;
  savedAt: number;
  passages: number;
  words: number;
  project: StoryProject;
  parseDiagnostics: Diagnostic[];
}

export type DraftSummary = Omit<Draft, 'project' | 'parseDiagnostics'>;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const listeners = new Set<() => void>();
/** Called whenever drafts are added or removed, so every list stays current. */
export function onDraftsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn());

export async function keepDraft(project: StoryProject, parseDiagnostics: Diagnostic[], label: string, auto = false): Promise<void> {
  const st = storyStats(project);
  const draft: Omit<Draft, 'id'> = {
    projectId: project.project.id,
    title: project.project.title,
    label,
    auto,
    savedAt: Date.now(),
    passages: st.passages,
    words: st.words,
    project: structuredClone(project),
    parseDiagnostics,
  };
  try {
    await tx('readwrite', (s) => s.add(draft));
    draftLog.info('Kept a draft', { auto, passages: st.passages, words: st.words });
    await prune();
  } catch (e) {
    draftLog.error('Could not keep a draft', errorData(e));
    throw e;
  } finally {
    changed();
  }
}

/** Newest first, without the (large) project bodies. */
export async function listDrafts(): Promise<DraftSummary[]> {
  try {
    const all = await tx<Draft[]>('readonly', (s) => s.getAll());
    return all.map(({ project: _p, parseDiagnostics: _d, ...rest }) => rest).sort((a, b) => b.savedAt - a.savedAt);
  } catch (e) {
    draftLog.warn('Could not read drafts', errorData(e));
    return [];
  }
}

export async function getDraft(id: number): Promise<Draft | undefined> {
  return tx<Draft | undefined>('readonly', (s) => s.get(id));
}

export async function deleteDraft(id: number): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
  draftLog.info('Deleted a draft');
  changed();
}

async function prune() {
  const all = await listDrafts();
  if (all.length <= KEEP) return;
  // Remove automatic drafts before ones the writer named, oldest first.
  const order = [...all].sort((a, b) => Number(b.auto) - Number(a.auto) || a.savedAt - b.savedAt);
  for (const d of order.slice(0, all.length - KEEP)) await tx('readwrite', (s) => s.delete(d.id));
}

/** "today 14:05", "yesterday 09:30", "3 Nov 2026". */
export function when(t: number, now = Date.now()): string {
  const d = new Date(t);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(d)) / 86400000);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
