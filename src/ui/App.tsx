import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { buildStory, type SourceInput } from '../core/builder';
import type { Diagnostic } from '../core/diagnostics';
import type { ConversionMode, StoryProject } from '../core/isr';
import { processProject, type ConversionState } from '../core/pipeline';
import { validateSchema } from '../core/schema';
import { download } from './common';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { ExportView } from './ExportView';
import { GraphView } from './GraphView';
import { ImportView } from './ImportView';
import { InkView } from './InkView';
import { PlaytestView } from './PlaytestView';
import { passageForEntity } from './projectOps';
import { ReviewView, STORY_SETTINGS } from './ReviewView';
import { ThemeToggle } from './ThemeToggle';

type Tab = 'import' | 'review' | 'graph' | 'ink' | 'play' | 'export';
// Tabs read as chapters of the book, numbered in roman numerals.
const TABS: { id: Tab; label: string; key: string; numeral: string }[] = [
  { id: 'import', label: 'Import', key: '1', numeral: 'I' },
  { id: 'review', label: 'Review', key: '2', numeral: 'II' },
  { id: 'graph', label: 'Graph', key: '3', numeral: 'III' },
  { id: 'ink', label: 'Ink', key: '4', numeral: 'IV' },
  { id: 'play', label: 'Playtest', key: '5', numeral: 'V' },
  { id: 'export', label: 'Export', key: '6', numeral: 'VI' },
];

const STAGES: { state: ConversionState; label: string }[] = [
  { state: 'Parsing', label: 'Parse' },
  { state: 'ReviewRequired', label: 'Review' },
  { state: 'Generating', label: 'Generate' },
  { state: 'Validating', label: 'Validate' },
  { state: 'Exporting', label: 'Export' },
];

const STORAGE_KEY = 'narrative-bridge.project.v1';

interface Saved {
  project: StoryProject;
  parseDiagnostics: Diagnostic[];
}

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    return validateSchema(s.project).some((d) => d.severity === 'error') ? null : s;
  } catch {
    return null;
  }
}

export function App() {
  const initial = useMemo(loadSaved, []);
  const [project, setProject] = useState<StoryProject | null>(initial?.project ?? null);
  const [parseDiagnostics, setParseDiagnostics] = useState<Diagnostic[]>(initial?.parseDiagnostics ?? []);
  const [tab, setTab] = useState<Tab>(initial ? 'review' : 'import');
  const [selected, setSelected] = useState<string>(initial?.project.project.startPassage ?? '');
  const [showDiag, setShowDiag] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exportState, setExportState] = useState<'Exporting' | 'Succeeded' | 'Failed' | null>(null);
  const undoStack = useRef<StoryProject[]>([]);
  const redoStack = useRef<StoryProject[]>([]);
  const [, force] = useState(0);
  const openRef = useRef<HTMLInputElement>(null);

  const deferred = useDeferredValue(project);
  const processed = useMemo(() => (deferred ? processProject(deferred, parseDiagnostics) : null), [deferred, parseDiagnostics]);
  const stale = deferred !== project;

  useEffect(() => {
    if (!project) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ project, parseDiagnostics }));
    } catch {
      /* storage full or unavailable: autosave is a convenience only */
    }
  }, [project, parseDiagnostics]);

  const lastEdit = useRef<{ group: string; at: number } | null>(null);
  /**
   * Applies an edit to a copy of the project. Edits sharing a `group` (e.g. keystrokes in one text
   * field) within two seconds of each other become a single undo step.
   */
  const update = useCallback((fn: (draft: StoryProject) => void, group?: string) => {
    const now = Date.now();
    const merge = !!group && lastEdit.current?.group === group && now - lastEdit.current.at < 2000;
    lastEdit.current = group ? { group, at: now } : null;
    setProject((cur) => {
      if (!cur) return cur;
      const next = structuredClone(cur);
      fn(next);
      if (!merge) {
        undoStack.current.push(cur);
        if (undoStack.current.length > 100) undoStack.current.shift();
      }
      redoStack.current = [];
      return next;
    });
    setExportState(null);
  }, []);

  const undo = useCallback(() => {
    lastEdit.current = null;
    const prev = undoStack.current.pop();
    if (!prev) return;
    setProject((cur) => {
      if (cur) redoStack.current.push(cur);
      return prev;
    });
    force((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    setProject((cur) => {
      if (cur) undoStack.current.push(cur);
      return next;
    });
    force((n) => n + 1);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = (e.target as HTMLElement).closest('input, textarea, select');
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (mod && /^[1-6]$/.test(e.key) && project) {
        e.preventDefault();
        setTab(TABS[+e.key - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, project]);

  const convert = async (inputs: SourceInput[], mode: ConversionMode, title?: string) => {
    setBusy(true);
    try {
      const { project: p, diagnostics } = await buildStory(inputs, { mode, title });
      undoStack.current = [];
      redoStack.current = [];
      setParseDiagnostics(diagnostics);
      setProject(p);
      setSelected(p.project.startPassage);
      setExportState(null);
      setTab('review');
    } finally {
      setBusy(false);
    }
  };

  const open = (id: string) => {
    setSelected(id);
    setTab('review');
  };

  const jump = (d: Diagnostic) => {
    if (!project) return;
    const pid = passageForEntity(project, d.entityId, d.details?.passageId);
    if (d.stage === 'ink_compilation') setTab('ink');
    else if (pid) open(pid);
    else if (project.items.some((i) => i.id === d.entityId) || project.variables.some((v) => v.id === d.entityId)) open(STORY_SETTINGS);
  };

  const openProject = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const p: StoryProject = data.project?.schemaVersion ? data.project : data;
      const errs = validateSchema(p).filter((d) => d.severity === 'error');
      if (errs.length) return alert(`Not a valid Narrative Bridge project:\n${errs.map((e) => e.message).join('\n')}`);
      undoStack.current = [];
      setParseDiagnostics(data.parseDiagnostics ?? []);
      setProject(p);
      setSelected(p.project.startPassage);
      setTab('review');
    } catch (e) {
      alert(`Could not open project: ${e}`);
    }
  };

  const state: ConversionState = busy ? 'Parsing' : exportState ?? (stale ? 'Validating' : processed?.state ?? 'Queued');
  const stageIndex = (() => {
    if (!processed) return -1;
    if (exportState === 'Succeeded') return 5;
    if (exportState) return 4;
    if (processed.exportBlocked) return 3;
    if (processed.state === 'ReviewRequired') return 1;
    return 4;
  })();
  const counts = processed
    ? { error: processed.diagnostics.filter((d) => d.severity === 'error').length, warning: processed.diagnostics.filter((d) => d.severity === 'warning').length, review: processed.diagnostics.filter((d) => d.severity === 'review').length }
    : null;

  return (
    <div className={`app ${processed && showDiag && tab !== 'import' ? 'with-diag' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
            <path d="M2 17 C 7 7, 17 7, 22 17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M6 17 V 12 M12 17 V 9.5 M18 17 V 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>Narrative Bridge</span>
        </div>
        {project && (
          <>
            <span className="project-name" title={project.project.title}>
              {project.project.title}
            </span>
            <ol className="stages" aria-label={`Conversion state: ${state}`}>
              {STAGES.map((s, i) => (
                <li key={s.state} className={i < stageIndex ? 'done' : i === stageIndex ? (processed?.exportBlocked || exportState === 'Failed' ? 'failed' : 'current') : ''}>
                  {s.label}
                </li>
              ))}
            </ol>
            <span className={`state-pill state-${state}`}>{state}</span>
          </>
        )}
        <span className="spacer" />
        <button className="btn tiny ghost" onClick={undo} disabled={!undoStack.current.length} title="Undo (⌘Z)">
          ↶
        </button>
        <button className="btn tiny ghost" onClick={redo} disabled={!redoStack.current.length} title="Redo (⇧⌘Z)">
          ↷
        </button>
        <ThemeToggle />
        <button className="btn tiny ghost" onClick={() => openRef.current?.click()}>
          Open project
        </button>
        <input ref={openRef} type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && openProject(e.target.files[0])} />
        {project && (
          <button className="btn tiny ghost" onClick={() => download(`${project.project.id}.nbproj.json`, JSON.stringify({ project, parseDiagnostics }, null, 2), 'application/json')}>
            Save project
          </button>
        )}
        {project && (
          <button
            className="btn tiny ghost"
            onClick={() => {
              if (!confirm('Start a new conversion? The current project stays in your browser until you convert something else.')) return;
              setTab('import');
            }}
          >
            New
          </button>
        )}
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} disabled={t.id !== 'import' && !processed} onClick={() => setTab(t.id)} title={`⌘${t.key}`}>
            <span className="tab-num">{t.numeral}</span>
            {t.label}
            {t.id === 'review' && counts && counts.review > 0 && <span className="tab-count review">{counts.review}</span>}
          </button>
        ))}
        <span className="spacer" />
        {processed && tab !== 'import' && (
          <button className={`diag-toggle ${showDiag ? 'on' : ''}`} onClick={() => setShowDiag(!showDiag)}>
            {counts!.error > 0 && <span className="sev sev-error">● {counts!.error}</span>}
            {counts!.warning > 0 && <span className="sev sev-warning">▲ {counts!.warning}</span>}
            {counts!.error + counts!.warning === 0 && <span className="sev sev-ok">✓</span>}
            Diagnostics
          </button>
        )}
      </nav>

      <div className="workspace">
        <div className="content">
          {tab === 'import' && <ImportView onConvert={convert} busy={busy} />}
          {processed && tab === 'review' && <ReviewView processed={{ ...processed, project: project! }} selected={selected} onSelect={setSelected} update={update} />}
          {processed && tab === 'graph' && <GraphView graph={processed.analysis.graph} start={processed.project.project.startPassage} selected={selected} onOpen={open} endingsReached={processed.smoke?.endingsReached} />}
          {processed && tab === 'ink' && <InkView processed={processed} onOpen={open} />}
          {processed && tab === 'play' && <PlaytestView processed={processed} onOpen={open} />}
          {processed && tab === 'export' && <ExportView processed={processed} onState={setExportState} />}
          {(tab === 'import' || tab === 'export') && <footer className="folio">— {TABS.find((t) => t.id === tab)!.numeral.toLowerCase()} —</footer>}
        </div>
        {processed && showDiag && tab !== 'import' && <DiagnosticsPanel diagnostics={processed.diagnostics} project={project!} onJump={jump} onClose={() => setShowDiag(false)} />}
      </div>
    </div>
  );
}
