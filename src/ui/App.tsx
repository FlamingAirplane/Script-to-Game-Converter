import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reviewAll } from '../core/adapt';
import { buildStory, type SourceInput } from '../core/builder';
import type { Diagnostic } from '../core/diagnostics';
import { fileBase, type ConversionMode, type StoryProject } from '../core/isr';
import type { ConversionState } from '../core/pipeline';
import { validateSchema } from '../core/schema';
import { DiagnosticsPanel, type PanelView } from './DiagnosticsPanel';
import { GraphView } from './GraphView';
import { ImportView } from './ImportView';
import { InkView } from './InkView';
import { passageForEntity } from './projectOps';
import { ReviewView, STORY_SETTINGS } from './ReviewView';
import { packProject, unpackProject } from './projectFile';
import { ProjectsSheet } from './ProjectsSheet';
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
import { IS_MAC, isTyping, MOD, modKey, plainKey, ShortcutSheet } from './Shortcuts';
import { ThemeToggle } from './ThemeToggle';
import { NewSceneSheet, type SceneRequest } from './NewScene';
import { useProcessedStory } from './useProcessedStory';

type Tab = 'import' | 'review' | 'graph' | 'ink' | 'play' | 'export';
// Tabs read as chapters of the book, numbered in roman numerals.
const TABS: { id: Tab; label: string; key: string; numeral: string; about: string }[] = [
  { id: 'import', label: 'Import', key: '1', numeral: 'I', about: 'Bring in a script, or try a sample' },
  { id: 'review', label: 'Review', key: '2', numeral: 'II', about: 'Check and edit each passage (a scene or page of the story)' },
  { id: 'graph', label: 'Graph', key: '3', numeral: 'III', about: 'The story map: every passage and the choices between them' },
  { id: 'ink', label: 'Ink', key: '4', numeral: 'IV', about: 'The story in Ink, the scripting language game engines read' },
  { id: 'play', label: 'Playtest', key: '5', numeral: 'V', about: 'Play the story as a player would' },
  { id: 'export', label: 'Export', key: '6', numeral: 'VI', about: 'Share it as a web page, or package it for Unity or Unreal' },
];

const STAGES: { state: ConversionState; label: string }[] = [
  { state: 'Parsing', label: 'Parse' },
  { state: 'ReviewRequired', label: 'Review' },
  { state: 'Generating', label: 'Generate' },
  { state: 'Validating', label: 'Validate' },
  { state: 'Exporting', label: 'Export' },
];

const STATE_TIPS: Partial<Record<ConversionState, string>> = {
  ReviewRequired: 'Some suggestions are waiting for your OK in Review. The story still plays and exports without them.',
  Succeeded: 'The story builds cleanly and is ready to play and export.',
  Failed: 'Something stops the story from building. The Diagnostics panel lists what to fix.',
};

/** The conversion state in plain words, for the header badge. */
const STATE_WORDS: Record<ConversionState, string> = {
  Queued: 'Waiting',
  Parsing: 'Reading',
  ReviewRequired: 'Needs review',
  Generating: 'Building',
  Validating: 'Checking',
  Exporting: 'Exporting',
  Succeeded: 'Ready',
  Failed: 'Needs fixes',
  Cancelled: 'Stopped',
};

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

/** "just now", "5 min ago", "2 h ago", or a date. */
function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(at).toLocaleDateString();
}

export function App() {
  const initial = useMemo(loadSaved, []);
  const [project, setProject] = useState<StoryProject | null>(initial?.project ?? null);
  const [parseDiagnostics, setParseDiagnostics] = useState<Diagnostic[]>(initial?.parseDiagnostics ?? []);
  const [tab, setTab] = useState<Tab>(initial ? 'review' : 'import');
  const [soundOn, setSoundOn] = useState(sfx.enabled);
  const [showKeys, setShowKeys] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
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
  // When this project was last saved to a file or the cloud (remembered per project), and which version.
  const [copy, setCopy] = useState<{ at: number; project: StoryProject | null } | null>(null);
  const baseline = useRef<StoryProject | null>(project);
  const [remindLater, setRemindLater] = useState(0);
  // Since when the project has had work that isn't in a saved copy; the reminder waits a few minutes.
  const unsaved = !!project && project !== copy?.project && project !== baseline.current;
  const unsavedSince = useRef(0);
  if (!unsaved) unsavedSince.current = 0;
  else if (!unsavedSince.current) unsavedSince.current = Date.now();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000); // keeps "saved 5 min ago" current
    return () => clearInterval(t);
  }, []);
  const projectKey = project ? `narrative-bridge.copy-saved.${project.project.id}` : '';
  useEffect(() => {
    if (!projectKey) return;
    try {
      const at = Number(localStorage.getItem(projectKey));
      setCopy((c) => (c && c.project?.project.id === project?.project.id ? c : at ? { at, project: null } : null));
    } catch {
      /* not remembered */
    }
    // only when another project is opened
  }, [projectKey]);
  const markCopied = (p: StoryProject) => {
    const at = Date.now();
    setCopy({ at, project: p });
    try {
      localStorage.setItem(`narrative-bridge.copy-saved.${p.project.id}`, String(at));
    } catch {
      /* not remembered */
    }
  };

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

  const [justImported, setJustImported] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // On narrower screens the Diagnostics panel opens over the page instead of beside it.
  const [diagOverlay, setDiagOverlay] = useState(false);
  const narrow = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 1100px)').matches;
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => !(e.target as HTMLElement).closest('.tb-actions, .tb-menu') && setMenuOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);
  // The story a conversion just replaced, so it can be brought straight back.
  const [replaced, setReplaced] = useState<{ project: StoryProject; parseDiagnostics: Diagnostic[]; file: FileHandle | null } | null>(null);
  const [newNote, setNewNote] = useState(false);
  const convert = async (inputs: SourceInput[], mode: ConversionMode, title?: string) => {
    setBusy(true);
    try {
      const { project: p, diagnostics } = await buildStory(inputs, { mode, title });
      await keepBeforeReplacing('Before converting a new script');
      setReplaced(project?.passages.length ? { project, parseDiagnostics, file: projectFile } : null);
      setNewNote(false);
      undoStack.current = [];
      redoStack.current = [];
      setParseDiagnostics(diagnostics);
      setProject(p);
      setProjectFile(null); // a new story isn't saved anywhere yet
      setSavedToFile(null);
      void requestPersistence();
      setSelected(p.project.startPassage);
      setExportState(null);
      setJustImported(true);
      setTab('review');
    } finally {
      setBusy(false);
    }
  };

  const bringBack = async () => {
    if (!replaced) return;
    await keepBeforeReplacing('Before bringing back the previous story');
    undoStack.current = [];
    redoStack.current = [];
    setParseDiagnostics(replaced.parseDiagnostics);
    setProject(replaced.project);
    setProjectFile(replaced.file);
    setSavedToFile(null);
    setSelected(replaced.project.project.startPassage);
    setExportState(null);
    setJustImported(false);
    setReplaced(null);
    setTab('review');
  };

  const open = (id: string) => {
    setSelected(id);
    setTab('review');
  };
  // The New scene form, opened from Review, Playtest and Diagnostics (the Graph has its own, to show the scene on the map).
  const [sceneRequest, setSceneRequest] = useState<SceneRequest | null>(null);

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
    // Everything the project uses goes in the file, so it opens the same in any browser (projectFile.ts).
    const { json, files } = await packProject(project, parseDiagnostics);
    const audio = { length: files };
    try {
      let target: FileHandle | 'downloaded' | null;
      if (projectFile && !as) {
        await writeToHandle(projectFile, json);
        target = projectFile;
      } else target = await saveFile(`${fileBase(project)}.nbproj.json`, json, 'application/json', 'project');
      if (!target) return; // cancelled
      markCopied(snapshot);
      if (target !== 'downloaded') {
        setProjectFile(target);
        setSavedToFile(snapshot);
        void rememberRecent(target, project.project.title);
      }
      void requestPersistence();
      appLog.info('Saved project file', { passages: project.passages.length, clips: audio.length, bytes: json.length, toFile: target !== 'downloaded' });
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

  const openProject = (file: File, handle?: FileHandle) => openProjectText(file.text(), 'file', handle);

  /** Opens a project from a project file's text (a file, or the cloud). */
  const openProjectText = async (text: Promise<string>, from: 'file' | 'cloud', handle?: FileHandle) => {
    try {
      let unpacked: Awaited<ReturnType<typeof unpackProject>>;
      try {
        unpacked = await unpackProject(await text);
      } catch (e) {
        return alert(e instanceof Error ? e.message : String(e));
      }
      const p = unpacked.project;
      appLog.info(from === 'cloud' ? 'Opened project from the cloud' : 'Opened project file', { files: unpacked.files });
      await keepBeforeReplacing(from === 'cloud' ? 'Before opening a project from the cloud' : 'Before opening a project file');
      undoStack.current = [];
      setParseDiagnostics(unpacked.parseDiagnostics);
      setProject(p);
      baseline.current = p;
      markCopied(p); // it came from a saved copy
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
    <div className={`app ${showDiag && ((processed && tab !== 'import') || panelView === 'log') ? 'with-diag' : ''} ${diagOverlay ? 'diag-overlay' : ''}`}>
      {diagOverlay && <div className="diag-backdrop" aria-hidden onClick={() => setDiagOverlay(false)} />}
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
            <ol className="stages" aria-label={`Conversion state: ${STATE_WORDS[state]}`}>
              {STAGES.map((s, i) => (
                <li key={s.state} className={i < stageIndex ? 'done' : i === stageIndex ? (processed?.exportBlocked || exportState === 'Failed' ? 'failed' : 'current') : ''}>
                  {s.label}
                </li>
              ))}
            </ol>
            <span className={`state-pill state-${state}`} title={STATE_TIPS[state] ?? undefined}>
              {STATE_WORDS[state]}
            </span>
            {projectFile ? (
              <span className="autosave" title={`Save (⌘S) writes to ${projectFile.name}. Every change is also kept in this browser.`}>
                {savedToFile === project ? `✓ saved to ${projectFile.name}` : `edited · ⌘S saves to ${projectFile.name}`}
              </span>
            ) : (
              autosave === 'saved' && (
                <span className="autosave" title="Every change is kept in this browser, which can be cleared. Use Save project for a file you can back up or open anywhere.">
                  ✓ kept in this browser · {copy ? `saved to a file ${ago(copy.at)}` : 'not saved to a file yet'}
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
        <button className="btn tiny ghost" onClick={undo} disabled={!undoStack.current.length} title="Undo your last change (⌘Z)" aria-label="Undo">
          ↶ <span className="tb-word">undo</span>
        </button>
        <button className="btn tiny ghost" onClick={redo} disabled={!redoStack.current.length} title="Redo (⇧⌘Z)" aria-label="Redo">
          ↷ <span className="tb-word">redo</span>
        </button>
        {project && (
          <button className="btn tiny ghost" onClick={() => void saveProject()} title={projectFile ? `Save to ${projectFile.name} (⌘S)` : 'Save the project as a file (⌘S)'}>
            Save project
          </button>
        )}
        <button className="btn tiny ghost tb-menu" aria-expanded={menuOpen} aria-controls="tb-actions" onClick={() => setMenuOpen(!menuOpen)}>
          ☰ Menu
        </button>
        <div
          className={`tb-actions ${menuOpen ? 'open' : ''}`}
          id="tb-actions"
          onClick={(e) => (e.target as HTMLElement).closest('button') && setMenuOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setMenuOpen(false)}
        >
        <button className="btn tiny ghost" onClick={() => setShowKeys(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
          ⌨ <span className="tb-word">shortcuts</span>
        </button>
        <ThemeToggle />
        <button
          className={`btn tiny ghost sound-toggle ${soundOn ? 'on' : 'off'}`}
          title={soundOn ? 'Book sounds are on (page turns, choices, endings). Click to mute.' : 'Book sounds are off (the default). Click to turn on.'}
          onClick={() => {
            sfx.setEnabled(!soundOn);
            setSoundOn(!soundOn);
            if (!soundOn) sfx.choice();
          }}
        >
          <span aria-hidden className="sound-icon">♪</span> sounds: {soundOn ? 'on' : 'off'}
        </button>
        <button className="btn tiny ghost" onClick={() => void chooseProject()}>
          Open project
        </button>
        <input ref={openRef} type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && openProject(e.target.files[0])} />
        <button className="btn tiny ghost" onClick={() => setShowProjects(true)} title="Carry on in another browser or computer: as a file, or through the cloud">
          ⇅ Move to another browser
        </button>
        {project && canUseFiles() && (
          <button className="btn tiny ghost" onClick={() => void saveProject(true)} title="Save the project to a new file (⇧⌘S)">
            Save as…
          </button>
        )}
        {project && (
          <button
            className="btn tiny ghost"
            onClick={() => {
              setNewNote(true);
              setTab('import');
              requestAnimationFrame(() => document.querySelector('.content')?.scrollTo({ top: 0 }));
            }}
            title="Start a new story from a script or a sample. The open one is kept in Drafts." 
          >
            New
          </button>
        )}
        </div>
      </header>

      {unsaved && Date.now() - unsavedSince.current > 5 * 60_000 && Date.now() > remindLater && (!copy || Date.now() - copy.at > 15 * 60_000) && (
        <div className="save-reminder" role="status">
          <span>
            {copy ? `Your last saved copy is from ${ago(copy.at)}.` : 'This project is only in this browser so far.'} Browsers can clear what they keep, so save a copy you can
            open anywhere.
          </span>
          <button className="btn small primary" onClick={() => void saveProject()}>
            Save a copy now
          </button>
          <button className="btn small ghost" onClick={() => setRemindLater(Date.now() + 30 * 60_000)}>
            Later
          </button>
        </div>
      )}

      <nav className="tabs" aria-label="Chapters">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} disabled={t.id !== 'import' && !processed} onClick={() => setTab(t.id)} aria-keyshortcuts={`Meta+${t.key} Control+${t.key}`} title={t.id !== 'import' && !processed ? `${t.about}. Import a script (or try a sample) first.` : `${t.about}. Shortcut: ${MOD}${IS_MAC ? "" : "+"}${t.key}`}>
            <span className="tab-num" aria-hidden>{t.numeral}</span>
            {t.label}
            {t.id === 'review' && counts && counts.review > 0 && <span className="tab-count review">{counts.review}</span>}
          </button>
        ))}
        <span className="spacer" />
        {processed && tab !== 'import' && (
          <button
            className={`diag-toggle ${showDiag ? 'on' : ''}`}
            aria-expanded={narrow() ? diagOverlay : showDiag}
            onClick={() => {
              if (narrow()) {
                setShowDiag(true);
                setDiagOverlay(!diagOverlay);
              } else setShowDiag(!showDiag);
            }}
          >
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
          {tab === 'import' && newNote && project && (
            <div className="new-note card" role="status">
              <span>
                <strong>Ready for a new story.</strong> Add a script or pick a sample below. “{project.project.title}” stays open in the other chapters until you
                convert something, and is kept in Drafts after that.
              </span>
              <button className="btn tiny ghost" onClick={() => setNewNote(false)}>
                OK
              </button>
            </div>
          )}
          {tab === 'import' && <ImportView onConvert={convert} busy={busy} onRestoreDraft={(id) => void restoreDraft(id)} onOpenProject={(f, h) => void openProject(f, h)} incoming={incoming} />}
          {tab === 'review' && replaced && (
            <div className="new-note card" role="status">
              <span>
                “{replaced.project.project.title}” was replaced by “{project?.project.title}”. It’s kept in Drafts on the Import page.
              </span>
              <span className="row">
                <button className="btn tiny" onClick={() => void bringBack()}>
                  Bring “{replaced.project.project.title}” back
                </button>
                <button className="btn tiny ghost" onClick={() => setReplaced(null)}>
                  Dismiss
                </button>
              </span>
            </div>
          )}
          {project && !processed && tab !== 'import' && (
            <div className="building" role="status" aria-live="polite">
              <span className="spinner" aria-hidden />
              {busy ? 'Reading your script…' : 'Building your story…'}
            </div>
          )}
          {processed && tab === 'review' && justImported && (
            <ImportSummary
              passages={processed.project.passages.length}
              characters={processed.project.characters.length}
              choices={processed.project.passages.reduce((n, ps) => n + ps.choices.length, 0)}
              endings={processed.analysis.endings.length}
              noSuggestions={processed.project.project.mode === 'adaptation' && !processed.project.passages.some((ps) => ps.choices.some((c) => c.origin === 'generated'))}
              counts={{
                error: processed.diagnostics.filter((d) => d.severity === 'error').length,
                warning: processed.diagnostics.filter((d) => d.severity === 'warning').length,
                review: processed.diagnostics.filter((d) => d.severity === 'review').length,
              }}
              onDiagnostics={() => {
                setShowDiag(true);
                setDiagOverlay(narrow());
              }}
              onClose={() => setJustImported(false)}
            />
          )}
          {processed && tab === 'review' && <ReviewView processed={{ ...processed, project: project! }} selected={selected} onSelect={setSelected} update={update} dialogueOnly={dialogueOnly} onDialogueOnly={setDialogueOnly} onKeepDraft={(label) => keepDraft(project!, parseDiagnostics, label)} onRestoreDraft={(id) => void restoreDraft(id)} onNewScene={setSceneRequest} />}
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
          {processed && tab === 'play' && <PlaytestView processed={processed} onOpen={open} dialogueOnly={dialogueOnly} onDialogueOnly={setDialogueOnly} showGated={showGated} onShowGated={setShowGated} onReview={() => setTab('review')} onApproveAll={() => update((d) => reviewAll(d, 'approved'))} onNewScene={setSceneRequest} />}
          {processed && tab === 'export' && <ExportView processed={processed} stale={stale} onState={setExportState} project={project!} update={update} onReview={() => setTab('review')} />}
          </Suspense>
          {sceneRequest && project && <NewSceneSheet project={project} update={update} request={sceneRequest} onCreated={open} onClose={() => setSceneRequest(null)} />}
          {(tab === 'import' || tab === 'export') && <footer className="folio">— {TABS.find((t) => t.id === tab)!.numeral.toLowerCase()} —</footer>}
        </div>
        {showDiag && ((processed && tab !== 'import') || panelView === 'log') && (
          <DiagnosticsPanel
            diagnostics={processed?.diagnostics ?? []}
            project={project}
            onJump={(d) => {
              setDiagOverlay(false);
              jump(d);
            }}
            onClose={() => {
              if (diagOverlay) setDiagOverlay(false);
              else setShowDiag(false);
            }}
            view={panelView}
            onView={setPanelView}
            onApproveAll={() => update((d) => reviewAll(d, 'approved'))}
            onNewScene={(r) => {
              setDiagOverlay(false);
              setSceneRequest(r);
            }}
          />
        )}
      </div>
      {showKeys && <ShortcutSheet onClose={() => setShowKeys(false)} />}
      {showProjects && (
        <ProjectsSheet
          project={project}
          parseDiagnostics={parseDiagnostics}
          onSaveFile={() => void saveProject(true)}
          onOpenFile={() => void chooseProject()}
          onOpenCloud={(text) => void openProjectText(text, 'cloud')}
          onCloudSaved={() => project && markCopied(project)}
          onClose={() => setShowProjects(false)}
        />
      )}
    </div>
  );
}

function ImportSummary(props: {
  passages: number;
  characters: number;
  choices: number;
  endings: number;
  /** Interactive adaptation ran but found nothing to suggest. */
  noSuggestions?: boolean;
  counts: { error: number; warning: number; review: number };
  onDiagnostics: () => void;
  onClose: () => void;
}) {
  const n = (k: number, one: string, many = one + 's') => `${k} ${k === 1 ? one : many}`;
  const { error, warning, review } = props.counts;
  const issues = error + warning + review;
  return (
    <section className="import-summary card" role="status" aria-label="What was understood">
      <h2 className="import-summary-title">What was understood</h2>
      <p>
        {n(props.passages, 'passage')} · {n(props.characters, 'character')} · {n(props.choices, 'choice')} · {n(props.endings, 'ending')}
      </p>
      <p className="small">
        {issues === 0
          ? '✓ Nothing to check: it built cleanly. Try it on the Play tab.'
          : `${[error && n(error, 'error'), warning && n(warning, 'warning'), review && n(review, 'thing', 'things') + ' to review'].filter(Boolean).join(', ')}. ` +
            'Errors stop the export; warnings and reviews are worth a look but don’t.'}
      </p>
      {props.noSuggestions && (
        <p className="small import-no-suggestions">
          No choices were suggested. Interactive adaptation suggests one when someone in the action picks up, takes, finds or pockets a thing (“Mira pockets the brass key.”), and locks a later scene that uses it
          (“She unlocks the door with the key.”) until the reader has it. You can add choices yourself in Review, or write them into the script as <code>+ [Choice text] -&gt; passage</code> lines.
        </p>
      )}
      <div className="row">
        {issues > 0 && (
          <button className="btn small" onClick={props.onDiagnostics}>
            Show what to check
          </button>
        )}
        <button className="btn small ghost" onClick={props.onClose}>
          Got it
        </button>
      </div>
    </section>
  );
}
