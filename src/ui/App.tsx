import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reviewAll } from '../core/adapt';
import { buildStory, type SourceInput } from '../core/builder';
import type { Diagnostic } from '../core/diagnostics';
import type { ConversionMode, StoryProject } from '../core/isr';
import type { ConversionState } from '../core/pipeline';
import { DiagnosticsPanel, type PanelView } from './DiagnosticsPanel';
import { ImportView, SITE } from './ImportView';
import { passageForEntity, STORY_SETTINGS } from './projectOps';
import { useEditHistory } from './editHistory';
import { loadSaved, useAutosave } from './useAutosave';
import { useShortcuts } from './useShortcuts';
import { ago, useProjectFiles } from './useProjectFiles';
import { ProjectsSheet } from './ProjectsSheet';
import { log } from '../core/log';
import { Logo, Wordmark } from './Logo';
import { Loading } from './Loading';
import { ArrowLeftRight, BookOpen, Code2, FilePlus2, FileUp, FolderOpen, Keyboard, ListChecks, Menu, MessageSquare, Music, Network, Package, Play, Redo2, Save, SaveAll, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { designSetting, useWord } from './design/design';
import { getDraft, keepDraft } from './draftStore';
import { canUseFiles, requestPersistence, type FileHandle } from './platform';

const appLog = log('app');

// Loaded on first use: Export carries the exporters, zip library and Ink runtime; Playtest the runtime.
// Every chapter after Import loads when it's first needed, so the first page comes up quickly; Review, Graph and Ink
// are fetched in the background once the page is idle, so they're ready by the time a script is converted.
const loadReview = () => import('./ReviewView');
const loadGraph = () => import('./GraphView');
const loadInk = () => import('./InkView');
const ReviewView = lazy(() => loadReview().then((m) => ({ default: m.ReviewView })));
const GraphView = lazy(() => loadGraph().then((m) => ({ default: m.GraphView })));
const InkView = lazy(() => loadInk().then((m) => ({ default: m.InkView })));
const ExportView = lazy(() => import('./ExportView').then((m) => ({ default: m.ExportView })));
const PlaytestView = lazy(() => import('./PlaytestView').then((m) => ({ default: m.PlaytestView })));
import { sfx } from './sfx';
import { IS_MAC, MOD, ShortcutSheet } from './Shortcuts';
import { ThemeToggle } from './ThemeToggle';
import { NewSceneSheet, type SceneRequest } from './NewScene';
import { useProcessedStory } from './useProcessedStory';

type Tab = 'import' | 'review' | 'graph' | 'ink' | 'play' | 'export';
// Tabs read as chapters of the book, numbered in roman numerals.
const TAB_ICONS: Record<Tab, LucideIcon> = { import: FileUp, review: ListChecks, graph: Network, ink: Code2, play: Play, export: Package };

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

export function App() {
  const initial = useMemo(() => loadSaved(), []);
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
  // Fetch the editing chapters once the first page is up and the browser is idle.
  useEffect(() => {
    const fetchAll = () => void Promise.all([loadReview(), loadGraph(), loadInk()]).catch(() => {});
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(fetchAll, { timeout: 4000 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(fetchAll, 1500);
    return () => clearTimeout(t);
  }, []);
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

  // Processed in a background worker; `stale` while a newer edit is being processed.
  const { processed, stale } = useProcessedStory(project, parseDiagnostics);

  // Autosave to this browser (see useAutosave.ts); a newer autosave than the quick copy replaces it on start-up.
  const autosave = useAutosave({
    initial,
    project,
    parseDiagnostics,
    onRestore: (s) => {
      setParseDiagnostics(s.parseDiagnostics ?? []);
      setProject(s.project);
      setSelected(s.project.project.startPassage);
      setTab('review');
    },
  });

  // Edit history (see editHistory.ts): `update` applies an edit to a copy; edits in one group within two seconds are one undo step.
  const onEdit = useCallback(() => setExportState(null), []);
  const { update, undo, redo, reset: resetHistory, keep: keepInHistory, canUndo, canRedo } = useEditHistory(setProject, onEdit);

  const [incoming, setIncoming] = useState<File[]>();
  // The project as a file (see useProjectFiles.ts): opening, saving, and the reminder to save a copy.
  const files = useProjectFiles({
    project,
    parseDiagnostics,
    onOpened: (p, diagnostics) => {
      resetHistory();
      setParseDiagnostics(diagnostics);
      setProject(p);
      setSelected(p.project.startPassage);
      setTab('review');
    },
    onScripts: (scripts) => {
      setIncoming(scripts);
      setTab('import');
    },
  });
  const { projectFile, savedToFile, copy, openRef, markCopied, keepBeforeReplacing, saveProject, chooseProject, openProject, openProjectText, detach } = files;

  useShortcuts(
    { project: !!project, tab },
    {
      undo,
      redo,
      tab: (n) => setTab(TABS[n - 1].id),
      save: () => keys.current.save(),
      saveAs: () => keys.current.saveAs(),
      open: () => keys.current.open(),
      find: () => keys.current.find(),
      log: () => {
        setPanelView('log');
        setShowDiag(true);
      },
      toggleDiagnostics: () => setShowDiag((v) => !v),
      help: () => setShowKeys(true),
      dialogueOnly: () => keys.current.dialogueOnly(),
      showGated: () => keys.current.showGated(),
      step: (dir) => keys.current.step(dir),
    },
  );

  const restoreDraft = async (id: number) => {
    const d = await getDraft(id);
    if (!d) return;
    const replacing = project && project.project.id !== d.projectId;
    if (replacing && !confirm(`Open “${d.title}” (${d.label})? The story that is open now is kept as a draft.`)) return;
    await keepBeforeReplacing(replacing ? 'Before opening another story' : `Before restoring “${d.label}”`);
    if (project && !replacing) {
      // Restoring is one undoable step within the same story.
      keepInHistory(project);
    } else {
      resetHistory();
    }
    setParseDiagnostics(d.parseDiagnostics);
    setProject(d.project);
    if (replacing) {
      detach();
    }
    setSelected(replacing || !project ? d.project.project.startPassage : selected);
    setExportState(null);
    setTab('review');
    appLog.info('Restored a draft', { passages: d.passages, otherStory: !!replacing });
  };

  const [justImported, setJustImported] = useState(false);
  // The ribbon bookmark hangs over the top of the page: it's tucked away while what's under it is scrolled,
  // so it never sits on a line's buttons.
  const workspace = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = workspace.current;
    if (!el) return;
    const ribbon = () => el.querySelector('.ribbon');
    ribbon()?.classList.remove('tucked');
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLElement && !t.closest('.diagnostics, .source-pane, .passage-list')) ribbon()?.classList.toggle('tucked', t.scrollTop > 8);
    };
    el.addEventListener('scroll', onScroll, true);
    return () => el.removeEventListener('scroll', onScroll, true);
  }, [tab]);
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
      resetHistory();
      setParseDiagnostics(diagnostics);
      setProject(p);
      detach(); // a new story isn't saved anywhere yet
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
    resetHistory();
    setParseDiagnostics(replaced.parseDiagnostics);
    setProject(replaced.project);
    detach(replaced.file);
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
  // Deference: a story that built cleanly opens with the Diagnostics panel out of the way; one with
  // problems opens with it showing. Decided once per story, so the writer's own toggling sticks.
  const diagDecided = useRef('');
  useEffect(() => {
    if (!processed || !project || diagDecided.current === project.project.id) return;
    diagDecided.current = project.project.id;
    setShowDiag(processed.diagnostics.some((d) => d.severity === 'error' || d.severity === 'warning'));
  }, [processed, project]);
  const counts = processed
    ? { error: processed.diagnostics.filter((d) => d.severity === 'error').length, warning: processed.diagnostics.filter((d) => d.severity === 'warning').length, review: processed.diagnostics.filter((d) => d.severity === 'review').length }
    : null;

  return (
    <div className={`app ${showDiag && ((processed && tab !== 'import') || panelView === 'log') ? 'with-diag' : ''} ${diagOverlay ? 'diag-overlay' : ''}`}>
      {diagOverlay && <div className="diag-backdrop" aria-hidden onClick={() => setDiagOverlay(false)} />}
      <header className="topbar">
        <div className="brand">
          <Logo size={24} />
          <Wordmark name={brand} />
        </div>
        {project && (
          <>
            <ProjectTitle title={project.project.title} onRename={(t) => update((d) => (d.project.title = t))} />
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
        <button className="btn tiny ghost" onClick={undo} disabled={!canUndo()} title="Undo your last change (⌘Z)" aria-label="Undo">
          <Undo2 size={15} aria-hidden /> <span className="tb-word">Undo</span>
        </button>
        <button className="btn tiny ghost" onClick={redo} disabled={!canRedo()} title="Redo (⇧⌘Z)" aria-label="Redo">
          <Redo2 size={15} aria-hidden /> <span className="tb-word">Redo</span>
        </button>
        {project && (
          <button className="btn tiny ghost" onClick={() => void saveProject()} title={projectFile ? `Save to ${projectFile.name} (⌘S)` : 'Save the project as a file (⌘S)'}>
            <Save size={15} aria-hidden /> Save project
          </button>
        )}
        <button className="btn tiny ghost tb-menu" aria-expanded={menuOpen} aria-controls="tb-actions" title="Open or move a project, start a new story, theme, sounds and shortcuts" onClick={() => setMenuOpen(!menuOpen)}>
          <Menu size={15} aria-hidden /> Menu
        </button>
        <div
          className={`tb-actions ${menuOpen ? 'open' : ''}`}
          id="tb-actions"
          onClick={(e) => {
            // Theme and sounds are switches: the menu stays open so the change can be seen (and made again).
            const b = (e.target as HTMLElement).closest('button');
            if (b && !b.matches('.theme-toggle, .sound-toggle')) setMenuOpen(false);
          }}
          onKeyDown={(e) => e.key === 'Escape' && setMenuOpen(false)}
        >
        <button className="btn tiny ghost" onClick={() => setShowKeys(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
          <Keyboard size={15} aria-hidden /> <span className="tb-word">Shortcuts</span>
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
          <Music size={15} aria-hidden className="sound-icon" /> Sounds: {soundOn ? 'on' : 'off'}
        </button>
        <button className="btn tiny ghost" onClick={() => void chooseProject()}>
          <FolderOpen size={15} aria-hidden /> Open project
        </button>
        <input ref={openRef} type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && openProject(e.target.files[0])} />
        <button className="btn tiny ghost" onClick={() => setShowProjects(true)} title="Carry on in another browser or computer: as a file, or through the cloud">
          <ArrowLeftRight size={15} aria-hidden /> Move to another browser
        </button>
        {project && canUseFiles() && (
          <button className="btn tiny ghost" onClick={() => void saveProject(true)} title="Save the project to a new file (⇧⌘S)">
            <SaveAll size={15} aria-hidden /> Save as…
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
            <FilePlus2 size={15} aria-hidden /> New
          </button>
        )}
        {/* There are no usage statistics, by design: this is how to tell us where it got in the way. Nothing is sent from the app. */}
        <a
          className="btn tiny ghost"
          href="https://github.com/FlamingAirplane/Script-to-Game-Converter/issues/new/choose"
          target="_blank"
          rel="noopener noreferrer"
          title="Tell us where you got stuck, or what would help (opens GitHub; nothing about your story is sent)"
          onClick={() => setMenuOpen(false)}
        >
          <MessageSquare size={15} aria-hidden /> Send feedback
        </a>
        <a className="btn tiny ghost" href={`${SITE}making-of.html`} title="Every plan, guide, spec and script behind Pen to Ink" onClick={() => setMenuOpen(false)}>
          <BookOpen size={15} aria-hidden /> How it was made
        </a>
        </div>
      </header>

      {files.reminderDue() && (
        <div className="save-reminder" role="status">
          <span>
            {copy ? `Your last saved copy is from ${ago(copy.at)}.` : 'This project is only in this browser so far.'} Browsers can clear what they keep, so save a copy you can
            open anywhere.
          </span>
          <button className="btn small primary" onClick={() => void saveProject()}>
            Save a copy now
          </button>
          <button className="btn small ghost" onClick={files.remindLater}>
            Later
          </button>
        </div>
      )}

      <nav className="tabs" aria-label="Chapters">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} disabled={t.id !== 'import' && !processed} onClick={() => setTab(t.id)} aria-keyshortcuts={`Meta+${t.key} Control+${t.key}`} title={t.id !== 'import' && !processed ? `${t.about}. Import a script (or try a sample) first.` : `${t.about}. Shortcut: ${MOD}${IS_MAC ? "" : "+"}${t.key}`}>
            <span className="tab-num" aria-hidden>{t.numeral}</span>
            {(() => {
              const Icon = TAB_ICONS[t.id];
              return <Icon size={15} strokeWidth={1.9} aria-hidden />;
            })()}
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

      <div className="workspace" ref={workspace}>
        {/* Silk ribbon bookmark marking the open chapter (decorative). */}
        <div className="ribbon" aria-hidden key={tab}>
          <span>{TABS.find((t) => t.id === tab)!.numeral}</span>
        </div>
        <div className="content" key={`page-${tab}`}>
          <Suspense fallback={<p className="pad"><Loading label="Opening…" elapsed={false} /></p>}>
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
              <Loading label={busy ? 'Reading your script…' : 'Building your story…'} />
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

/** The story's title in the top bar: click it (or Enter on it) to rename the story. Enter or leaving keeps the new title, Escape doesn't. */
function ProjectTitle({ title, onRename }: { title: string; onRename: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = (keep: boolean) => {
    const t = draft?.trim();
    if (keep && t && t !== title) onRename(t);
    setDraft(null);
  };
  if (draft === null)
    return (
      <button type="button" className="project-name" title={`${title}: click to rename the story`} onClick={() => setDraft(title)}>
        {title || 'Untitled'}
      </button>
    );
  return (
    <input
      className="project-name editing"
      aria-label="Story title"
      autoFocus
      value={draft}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(true);
        else if (e.key === 'Escape') done(false);
        e.stopPropagation();
      }}
    />
  );
}
