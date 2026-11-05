import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildStory, type SourceInput } from '../core/builder';
import type { Diagnostic } from '../core/diagnostics';
import type { ConversionMode, StoryProject } from '../core/isr';
import type { ConversionState } from '../core/pipeline';
import { validateSchema } from '../core/schema';
import { DiagnosticsPanel, type PanelView } from './DiagnosticsPanel';
import { GraphView } from './GraphView';
import { ImportView } from './ImportView';
import { InkView } from './InkView';
import { passageForEntity } from './projectOps';
import { ReviewView, STORY_SETTINGS } from './ReviewView';
import { base64ToBytes, bytesToBase64, referencedAudio } from '../core/audio';
import { referencedImages } from '../core/images';
import { collectClips, putClip } from './audioStore';
import { errorData, log } from '../core/log';
import { Logo } from './Logo';
import { designSetting, useWord } from './design/design';
import { getDraft, keepDraft } from './draftStore';
import { canUseFiles, kvGet, kvSet, pickProjectFile, rememberRecent, requestPersistence, saveFile, storageUse, writeToHandle, type FileHandle } from './platform';

const appLog = log('app');

// Loaded on first use: Export carries the exporters, zip library and Ink runtime; Playtest the runtime.
const ExportView = lazy(() => import('./ExportView').then((m) => ({ default: m.ExportView })));
const PlaytestView = lazy(() => import('./PlaytestView').then((m) => ({ default: m.PlaytestView })));
import { sfx } from './sfx';
import { isTyping, modKey, plainKey, ShortcutSheet } from './Shortcuts';
import { ThemeToggle } from './ThemeToggle';
import { useProcessedStory } from './useProcessedStory';

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
  /** When it was autosaved (ms); the newer of the two autosaved copies wins on start-up. */
  savedAt?: number;
}

const valid = (s: Saved | null | undefined): s is Saved => !!s?.project && !validateSchema(s.project).some((d) => d.severity === 'error');

/** The quick copy in localStorage (kept while the project is small), read synchronously on start-up. */
function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = raw ? (JSON.parse(raw) as Saved) : null;
    return valid(s) ? s : null;
  } catch {
    return null;
  }
}

/** Projects larger than this are autosaved to IndexedDB only (localStorage holds about 5 MB in all). */
const QUICK_COPY_LIMIT = 1_500_000;

export function App() {
  const initial = useMemo(loadSaved, []);
  const [project, setProject] = useState<StoryProject | null>(initial?.project ?? null);
  const [parseDiagnostics, setParseDiagnostics] = useState<Diagnostic[]>(initial?.parseDiagnostics ?? []);
  const [tab, setTab] = useState<Tab>(initial ? 'review' : 'import');
  const [soundOn, setSoundOn] = useState(sfx.enabled);
  const [showKeys, setShowKeys] = useState(false);
  const [panelView, setPanelView] = useState<PanelView>('notes');
  // "Dialogue only": hide narration, transitions, notes and effects in Review and Playtest.
  const [dialogueOnly, setDialogueOnlyState] = useState(() => {
    try {
      return localStorage.getItem('narrative-bridge.dialogue-only') === 'on';
    } catch {
      return false;
    }
  });
  // "Gated choices": show choices that need an item or value in Playtest (greyed, with what they need)
  // and as padlock routes on the Graph. One setting for both, remembered.
  const [showGated, setShowGatedState] = useState(() => {
    try {
      const saved = localStorage.getItem('narrative-bridge.show-gated');
      return saved ? saved !== 'off' : designSetting<boolean>('showLocked');
    } catch {
      return designSetting<boolean>('showLocked');
    }
  });
  const brand = useWord('brand');
  const setShowGated = (on: boolean) => {
    setShowGatedState(on);
    try {
      localStorage.setItem('narrative-bridge.show-gated', on ? 'on' : 'off');
    } catch {
      /* preference not saved */
    }
  };
  const setDialogueOnly = (on: boolean) => {
    setDialogueOnlyState(on);
    try {
      localStorage.setItem('narrative-bridge.dialogue-only', on ? 'on' : 'off');
    } catch {
      /* preference not saved */
    }
  };
  const keys = useRef<{ tab: Tab; save: () => void | Promise<void>; saveAs: () => void | Promise<void>; open: () => void; find: () => void; step: (dir: 1 | -1) => void; dialogueOnly: () => void; showGated: () => void }>({
    tab: 'import',
    save: () => {},
    saveAs: () => {},
    open: () => {},
    find: () => {},
    step: () => {},
    dialogueOnly: () => {},
    showGated: () => {},
  });
  // A page turns whenever the chapter changes (not on first load).
  const prevTab = useRef(tab);
  useEffect(() => {
    if (prevTab.current !== tab) sfx.pageTurn();
    prevTab.current = tab;
  }, [tab]);
  const [selected, setSelected] = useState<string>(initial?.project.project.startPassage ?? '');
  const [showDiag, setShowDiag] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exportState, setExportState] = useState<'Exporting' | 'Succeeded' | 'Failed' | null>(null);
  const undoStack = useRef<StoryProject[]>([]);
  const redoStack = useRef<StoryProject[]>([]);
  const [, force] = useState(0);
  const openRef = useRef<HTMLInputElement>(null);

  // Processed in a background worker; `stale` while a newer edit is being processed.
  const { processed, stale } = useProcessedStory(project, parseDiagnostics);

  // Autosave to this browser: IndexedDB (room for large projects), plus a quick copy in localStorage
  // while the project is small. If both fail, say so: the writer must save a project file instead.
  const [autosave, setAutosave] = useState<'saved' | 'low' | 'failed' | null>(initial ? 'saved' : null);
  const loaded = useRef(false);
  useEffect(() => {
    // On start-up, a newer or larger autosave in IndexedDB replaces the quick copy.
    void kvGet<Saved>(STORAGE_KEY)
      .then((s) => {
        if (valid(s) && (!initial || (s.savedAt ?? 0) > (initial.savedAt ?? 0))) {
          setParseDiagnostics(s.parseDiagnostics ?? []);
          setProject(s.project);
          setSelected(s.project.project.startPassage);
          setTab('review');
          setAutosave('saved');
        }
      })
      .catch(() => {})
      .finally(() => (loaded.current = true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!project || !loaded.current) return;
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
        const next = !ok ? 'failed' : use !== null && use > 0.85 ? 'low' : 'saved';
        setAutosave((was) => {
          if (was !== next) {
            if (next === 'failed') appLog.warn('Autosave failed: browser storage is full or unavailable');
            else if (next === 'low') appLog.warn('Browser storage is almost full', { used: Math.round((use ?? 0) * 100) });
            else if (was === 'failed' || was === 'low') appLog.info('Autosave works again');
          }
          return next;
        });
      });
  }, [project, parseDiagnostics]);
  // Closing the page while autosave is failing would lose work: let the browser ask first.
  useEffect(() => {
    if (autosave !== 'failed') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [autosave]);

  // Files the system opens with the installed app (manifest file_handlers, Chrome/Edge): project files
  // open straight away; scripts and stories go to the Import page's file list.
  const [incoming, setIncoming] = useState<File[]>();
  const openRefFn = useRef<(f: File, h?: FileHandle) => void>(() => {});
  useEffect(() => {
    const queue = (window as unknown as { launchQueue?: { setConsumer(fn: (p: { files: FileHandle[] }) => void): void } }).launchQueue;
    queue?.setConsumer(async ({ files }) => {
      const scripts: File[] = [];
      for (const h of files ?? []) {
        const f = await h.getFile();
        if (/\.json$/i.test(f.name)) openRefFn.current(f, h);
        else scripts.push(f);
      }
      if (scripts.length) {
        setIncoming(scripts);
        setTab('import');
      }
      appLog.info('Opened files from the system', { files: files?.length ?? 0 });
    });
  }, []);

  // The project file this story was opened from or saved to (Chrome/Edge), so Save writes back to it.
  const [projectFile, setProjectFile] = useState<FileHandle | null>(null);
  const [savedToFile, setSavedToFile] = useState<StoryProject | null>(null);

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
      const mod = modKey(e);
      const typing = isTyping(e);
      const k = e.key.toLowerCase();
      const h = keys.current;
      if (modKey(e, { shift: true }) && k === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && /^[1-6]$/.test(e.key) && project) {
        e.preventDefault();
        setTab(TABS[+e.key - 1].id);
      } else if (mod && k === 's' && project) {
        e.preventDefault();
        void h.save();
      } else if (modKey(e, { shift: true }) && e.shiftKey && k === 's' && project && canUseFiles()) {
        e.preventDefault();
        void h.saveAs();
      } else if (mod && k === 'o') {
        e.preventDefault();
        h.open();
      } else if (mod && k === 'f' && project) {
        e.preventDefault();
        h.find();
      } else if (mod && k === 'l') {
        e.preventDefault();
        setPanelView('log');
        setShowDiag(true);
      } else if (mod && e.key === '.' && project) {
        e.preventDefault();
        setShowDiag((v) => !v);
      } else if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShowKeys(true);
      } else if (e.key.toLowerCase() === 'd' && plainKey(e) && (h.tab === 'review' || h.tab === 'play')) {
        e.preventDefault();
        h.dialogueOnly();
      } else if (e.key.toLowerCase() === 'g' && plainKey(e) && (h.tab === 'play' || h.tab === 'graph') && project) {
        e.preventDefault();
        h.showGated();
      } else if ((e.key === '[' || e.key === ']') && plainKey(e) && h.tab === 'review' && project) {
        e.preventDefault();
        h.step(e.key === ']' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, project]);

  /** Keeps the open story as an automatic draft before something replaces it (never blocks the change). */
  const keepBeforeReplacing = async (label: string) => {
    if (!project?.passages.length) return;
    try {
      await keepDraft(project, parseDiagnostics, label, true);
    } catch {
      /* logged; the change goes ahead */
    }
  };

  const restoreDraft = async (id: number) => {
    const d = await getDraft(id);
    if (!d) return;
    const replacing = project && project.project.id !== d.projectId;
    if (replacing && !confirm(`Open “${d.title}” (${d.label})? The story that is open now is kept as a draft.`)) return;
    await keepBeforeReplacing(replacing ? 'Before opening another story' : `Before restoring “${d.label}”`);
    if (project && !replacing) {
      // Restoring is one undoable step within the same story.
      undoStack.current.push(project);
      redoStack.current = [];
    } else {
      undoStack.current = [];
      redoStack.current = [];
    }
    setParseDiagnostics(d.parseDiagnostics);
    setProject(d.project);
    if (replacing) {
      setProjectFile(null);
      setSavedToFile(null);
    }
    setSelected(replacing || !project ? d.project.project.startPassage : selected);
    setExportState(null);
    setTab('review');
    appLog.info('Restored a draft', { passages: d.passages, otherStory: !!replacing });
  };

  const convert = async (inputs: SourceInput[], mode: ConversionMode, title?: string) => {
    setBusy(true);
    try {
      const { project: p, diagnostics } = await buildStory(inputs, { mode, title });
      await keepBeforeReplacing('Before converting a new script');
      undoStack.current = [];
      redoStack.current = [];
      setParseDiagnostics(diagnostics);
      setProject(p);
      setProjectFile(null); // a new story isn't saved anywhere yet
      setSavedToFile(null);
      void requestPersistence();
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

  /**
   * Saves the project as one .nbproj.json file, with voice clips embedded so it is complete on its own.
   * Where the browser allows it, Save writes back to the file the project came from and Save As picks
   * a new one; elsewhere the file is downloaded.
   */
  const saveProject = async (as = false) => {
    if (!project) return;
    const snapshot = project;
    // Scene pictures share the "audio" map with voice clips (same store, keyed by id), so older versions still open the file.
    // Regions have no bytes of their own: the session recordings they play from are saved instead.
    const clips = await collectClips([...referencedAudio(project).filter((a) => !a.region), ...referencedImages(project), ...(project.sessions ?? [])]);
    const audio = Object.fromEntries(Object.entries(clips).map(([id, c]) => [id, { mime: c.mime, data: bytesToBase64(c.bytes) }]));
    const json = JSON.stringify({ project, parseDiagnostics, audio }, null, 2);
    try {
      let target: FileHandle | 'downloaded' | null;
      if (projectFile && !as) {
        await writeToHandle(projectFile, json);
        target = projectFile;
      } else target = await saveFile(`${project.project.id}.nbproj.json`, json, 'application/json', 'project');
      if (!target) return; // cancelled
      if (target !== 'downloaded') {
        setProjectFile(target);
        setSavedToFile(snapshot);
        void rememberRecent(target, project.project.title);
      }
      void requestPersistence();
      appLog.info('Saved project file', { passages: project.passages.length, clips: Object.keys(audio).length, bytes: json.length, toFile: target !== 'downloaded' });
    } catch (e) {
      appLog.error('Could not save the project file', errorData(e));
      alert(`Could not save the project file: ${e instanceof Error ? e.message : e}`);
    }
  };

  /** Open project: the system's Open dialog where the browser allows it (so Save can write back), else the file input. */
  const chooseProject = async () => {
    if (!canUseFiles()) return openRef.current?.click();
    const picked = await pickProjectFile();
    if (picked) await openProject(picked.file, picked.handle);
  };

  const openProject = async (file: File, handle?: FileHandle) => {
    try {
      const data = JSON.parse(await file.text());
      for (const [id, c] of Object.entries((data.audio ?? {}) as Record<string, { mime: string; data: string }>)) await putClip(id, c.mime, base64ToBytes(c.data));
      appLog.info('Opened project file', { bytes: file.size, clips: Object.keys(data.audio ?? {}).length });
      const p: StoryProject = data.project?.schemaVersion ? data.project : data;
      const errs = validateSchema(p).filter((d) => d.severity === 'error');
      if (errs.length) return alert(`Not a valid Narrative Bridge project:\n${errs.map((e) => e.message).join('\n')}`);
      await keepBeforeReplacing('Before opening a project file');
      undoStack.current = [];
      setParseDiagnostics(data.parseDiagnostics ?? []);
      setProject(p);
      setProjectFile(handle ?? null);
      setSavedToFile(handle ? p : null);
      if (handle) void rememberRecent(handle, p.project.title);
      void requestPersistence();
      setSelected(p.project.startPassage);
      setTab('review');
    } catch (e) {
      appLog.error('Could not open project file', errorData(e));
      alert(`Could not open project: ${e}`);
    }
  };

  openRefFn.current = (f, h) => void openProject(f, h);

  // Latest handlers for the keyboard shortcuts (the listener is registered once).
  keys.current = {
    tab,
    dialogueOnly: () => setDialogueOnly(!dialogueOnly),
    showGated: () => setShowGated(!showGated),
    save: () => saveProject(),
    saveAs: () => saveProject(true),
    open: () => void chooseProject(),
    find: () => {
      if (tab === 'graph') return document.querySelector<HTMLInputElement>('.graph-search')?.focus();
      if (tab !== 'review') setTab('review');
      setTimeout(() => {
        const panel = document.querySelector<HTMLDetailsElement>('.find-panel');
        if (panel) panel.open = true;
        panel?.querySelector<HTMLInputElement>('input')?.focus();
      }, 50);
    },
    step: (dir: 1 | -1) => {
      const ids = project?.passages.map((p) => p.id) ?? [];
      const i = ids.indexOf(selected);
      const next = ids[Math.max(0, Math.min(ids.length - 1, (i < 0 ? 0 : i) + dir))];
      if (next) setSelected(next);
    },
  };

  const state: ConversionState = busy ? 'Parsing' : exportState ?? (stale || processed?.smokePending ? 'Validating' : processed?.state ?? 'Queued');
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
    <div className={`app ${showDiag && ((processed && tab !== 'import') || panelView === 'log') ? 'with-diag' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <Logo size={26} />
          <span>{brand}</span>
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
            {projectFile ? (
              <span className="autosave" title={`Save (⌘S) writes to ${projectFile.name}. Every change is also kept in this browser.`}>
                {savedToFile === project ? `✓ saved to ${projectFile.name}` : `edited · ⌘S saves to ${projectFile.name}`}
              </span>
            ) : (
              autosave === 'saved' && (
                <span className="autosave" title="Every change is kept in this browser. Use Save project for a file you can back up or share.">
                  ✓ kept in this browser
                </span>
              )
            )}
            {autosave === 'low' && (
              <span className="autosave failed" role="status" title="This browser has almost no room left for this app. Save a project file so nothing is lost.">
                ⚠ storage almost full — save a project file
              </span>
            )}
            {autosave === 'failed' && (
              <span className="autosave failed" role="status" title="This browser has no room left (or blocks storage), so changes are not remembered after a reload.">
                ⚠ not autosaved — use Save project
              </span>
            )}
          </>
        )}
        <span className="spacer" />
        <button className="btn tiny ghost" onClick={undo} disabled={!undoStack.current.length} title="Undo (⌘Z)">
          ↶
        </button>
        <button className="btn tiny ghost" onClick={redo} disabled={!redoStack.current.length} title="Redo (⇧⌘Z)">
          ↷
        </button>
        <button className="btn tiny ghost" onClick={() => setShowKeys(true)} title="Keyboard shortcuts (?)">
          ⌨ keys
        </button>
        <ThemeToggle />
        <button
          className="btn tiny ghost"
          aria-pressed={soundOn}
          title={soundOn ? 'Book sounds on (page turns, choices, endings). Click to mute.' : 'Book sounds off. Click to turn on.'}
          onClick={() => {
            sfx.setEnabled(!soundOn);
            setSoundOn(!soundOn);
            if (!soundOn) sfx.choice();
          }}
        >
          {soundOn ? '♪ sounds' : '♪ muted'}
        </button>
        <button className="btn tiny ghost" onClick={() => void chooseProject()}>
          Open project
        </button>
        <input ref={openRef} type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && openProject(e.target.files[0])} />
        {project && (
          <button className="btn tiny ghost" onClick={() => void saveProject()} title={projectFile ? `Save to ${projectFile.name} (⌘S)` : 'Save the project as a file (⌘S)'}>
            Save project
          </button>
        )}
        {project && canUseFiles() && (
          <button className="btn tiny ghost" onClick={() => void saveProject(true)} title="Save the project to a new file (⇧⌘S)">
            Save as…
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

      <nav className="tabs" aria-label="Chapters">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} disabled={t.id !== 'import' && !processed} onClick={() => setTab(t.id)} title={`⌘${t.key}`}>
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
        {/* Silk ribbon bookmark marking the open chapter (decorative). */}
        <div className="ribbon" aria-hidden key={tab}>
          <span>{TABS.find((t) => t.id === tab)!.numeral}</span>
        </div>
        <div className="content" key={`page-${tab}`}>
          <Suspense fallback={<p className="muted pad">Turning the page…</p>}>
          {tab === 'import' && <ImportView onConvert={convert} busy={busy} onRestoreDraft={(id) => void restoreDraft(id)} onOpenProject={(f, h) => void openProject(f, h)} incoming={incoming} />}
          {processed && tab === 'review' && <ReviewView processed={{ ...processed, project: project! }} selected={selected} onSelect={setSelected} update={update} dialogueOnly={dialogueOnly} onDialogueOnly={setDialogueOnly} onKeepDraft={(label) => keepDraft(project!, parseDiagnostics, label)} onRestoreDraft={(id) => void restoreDraft(id)} />}
          {processed && tab === 'graph' && (
            <GraphView
              graph={processed.analysis.graph}
              start={processed.project.project.startPassage}
              selected={selected}
              onOpen={open}
              onSelect={setSelected}
              project={project!}
              update={update}
              endingsReached={processed.smoke?.endingsReached}
              title={project!.project.title}
              layout={project!.layout}
              onMove={(id, pos) => update((d) => (d.layout = { ...d.layout, [id]: pos }))}
              onResetLayout={() => update((d) => delete d.layout)}
              showGated={showGated}
              onShowGated={setShowGated}
            />
          )}
          {processed && tab === 'ink' && <InkView processed={processed} onOpen={open} />}
          {processed && tab === 'play' && <PlaytestView processed={processed} onOpen={open} dialogueOnly={dialogueOnly} onDialogueOnly={setDialogueOnly} showGated={showGated} onShowGated={setShowGated} />}
          {processed && tab === 'export' && <ExportView processed={processed} stale={stale} onState={setExportState} project={project!} update={update} />}
          </Suspense>
          {(tab === 'import' || tab === 'export') && <footer className="folio">— {TABS.find((t) => t.id === tab)!.numeral.toLowerCase()} —</footer>}
        </div>
        {showDiag && ((processed && tab !== 'import') || panelView === 'log') && (
          <DiagnosticsPanel
            diagnostics={processed?.diagnostics ?? []}
            project={project}
            onJump={jump}
            onClose={() => setShowDiag(false)}
            view={panelView}
            onView={setPanelView}
          />
        )}
      </div>
      {showKeys && <ShortcutSheet onClose={() => setShowKeys(false)} />}
    </div>
  );
}
