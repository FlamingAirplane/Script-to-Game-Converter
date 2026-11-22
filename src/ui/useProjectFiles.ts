import { useEffect, useRef, useState } from 'react';
import type { Diagnostic } from '../core/diagnostics';
import { fileBase, type StoryProject } from '../core/isr';
import { errorData, log } from '../core/log';
import { keepDraft } from './draftStore';
import { canUseFiles, pickProjectFile, rememberRecent, requestPersistence, saveFile, writeToHandle, type FileHandle } from './platform';
import { packProject, unpackProject } from './projectFile';
import { LINK_PREFIX, readStoryLink } from './storyLink';

// The project as a file: opening one (from disk, the cloud or a story link), saving it, and knowing when the work in
// the browser has no saved copy yet. The editor itself stays in App.tsx; this hands it a project to show.

const appLog = log('app');

/** "just now", "5 min ago", "2 h ago", or a date. */
export function ago(at: number, now = Date.now()): string {
  const min = Math.round((now - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(at).toLocaleDateString();
}

/** The reminder to save a copy waits this long after work begins that no saved copy holds. */
export const REMIND_AFTER_MS = 5 * 60_000;
/** …and is not shown while the last saved copy is newer than this. */
export const COPY_FRESH_MS = 15 * 60_000;
/** "Later" quiets the reminder for this long. */
export const REMIND_LATER_MS = 30 * 60_000;

/** Whether to remind the writer that this project is only in the browser: unsaved work for a while, and no recent copy. */
export function saveReminderDue(o: { unsaved: boolean; unsavedSince: number; remindLater: number; copyAt?: number; now?: number }): boolean {
  const now = o.now ?? Date.now();
  return o.unsaved && now - o.unsavedSince > REMIND_AFTER_MS && now > o.remindLater && (o.copyAt === undefined || now - o.copyAt > COPY_FRESH_MS);
}

type OpenedFrom = 'file' | 'cloud' | 'link';

const OPEN_LABELS: Record<OpenedFrom, string> = {
  file: 'Before opening a project file',
  cloud: 'Before opening a project from the cloud',
  link: 'Before opening a story link',
};

export function useProjectFiles({
  project,
  parseDiagnostics,
  onOpened,
  onScripts,
}: {
  project: StoryProject | null;
  parseDiagnostics: Diagnostic[];
  /** A project was opened: show it (the editor starts it afresh: no undo history, its first passage selected). */
  onOpened: (project: StoryProject, parseDiagnostics: Diagnostic[]) => void;
  /** The system handed the app script files to import. */
  onScripts: (files: File[]) => void;
}) {
  // The project file this story was opened from or saved to (Chrome/Edge), so Save writes back to it.
  const [projectFile, setProjectFile] = useState<FileHandle | null>(null);
  const [savedToFile, setSavedToFile] = useState<StoryProject | null>(null);
  // When this project was last saved to a file or the cloud (remembered per project), and which version.
  const [copy, setCopy] = useState<{ at: number; project: StoryProject | null } | null>(null);
  const baseline = useRef<StoryProject | null>(project);
  const [remindLater, setRemindLater] = useState(0);
  const openRef = useRef<HTMLInputElement>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the project id, not on every edit
  }, [projectKey]);

  /** This version is in a saved copy (a file or the cloud). */
  const markCopied = (p: StoryProject) => {
    const at = Date.now();
    setCopy({ at, project: p });
    try {
      localStorage.setItem(`narrative-bridge.copy-saved.${p.project.id}`, String(at));
    } catch {
      /* not remembered */
    }
  };

  /** Keeps the open story as an automatic draft before something replaces it (never blocks the change). */
  const keepBeforeReplacing = async (label: string) => {
    if (!project?.passages.length) return;
    try {
      await keepDraft(project, parseDiagnostics, label, true);
    } catch {
      /* logged; the change goes ahead */
    }
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
      appLog.info('Saved project file', { passages: project.passages.length, clips: files, bytes: json.length, toFile: target !== 'downloaded' });
    } catch (e) {
      appLog.error('Could not save the project file', errorData(e));
      alert(`Could not save the project file: ${e instanceof Error ? e.message : e}`);
    }
  };

  /** Opens a project from a project file's text (a file, or the cloud, or a story link). */
  const openProjectText = async (text: Promise<string>, from: OpenedFrom, handle?: FileHandle) => {
    try {
      let unpacked: Awaited<ReturnType<typeof unpackProject>>;
      try {
        unpacked = await unpackProject(await text);
      } catch (e) {
        return alert(e instanceof Error ? e.message : String(e));
      }
      const p = unpacked.project;
      appLog.info(from === 'cloud' ? 'Opened project from the cloud' : from === 'link' ? 'Opened story link' : 'Opened project file', { files: unpacked.files });
      await keepBeforeReplacing(OPEN_LABELS[from]);
      onOpened(p, unpacked.parseDiagnostics);
      baseline.current = p;
      if (from !== 'link') markCopied(p); // it came from a saved copy (a link isn't one the writer keeps)
      setProjectFile(handle ?? null);
      setSavedToFile(handle ? p : null);
      if (handle) void rememberRecent(handle, p.project.title);
      void requestPersistence();
    } catch (e) {
      appLog.error('Could not open project file', errorData(e));
      alert(`Could not open project: ${e}`);
    }
  };

  const openProject = (file: File, handle?: FileHandle) => openProjectText(file.text(), 'file', handle);

  /** Open project: the system's Open dialog where the browser allows it (so Save can write back), else the file input. */
  const chooseProject = async () => {
    if (!canUseFiles()) return openRef.current?.click();
    const picked = await pickProjectFile();
    if (picked) await openProject(picked.file, picked.handle);
  };

  // Files the system opens with the installed app (manifest file_handlers, Chrome/Edge): project files
  // open straight away; scripts and stories go to the Import page's file list.
  const latest = useRef({ openProject, onScripts });
  latest.current = { openProject, onScripts };
  useEffect(() => {
    const queue = (window as unknown as { launchQueue?: { setConsumer(fn: (p: { files: FileHandle[] }) => void): void } }).launchQueue;
    queue?.setConsumer(async ({ files }) => {
      const scripts: File[] = [];
      for (const h of files ?? []) {
        const f = await h.getFile();
        if (/\.json$/i.test(f.name)) void latest.current.openProject(f, h);
        else scripts.push(f);
      }
      if (scripts.length) latest.current.onScripts(scripts);
      appLog.info('Opened files from the system', { files: files?.length ?? 0 });
    });
  }, []);

  // A story link (#story=…, see storyLink.ts) opens that story, once; the open one is kept in Drafts first. It's read
  // when the app opens with one, and when one is pasted into the address bar of a tab where the app is already open.
  const openLink = useRef((text: Promise<string>) => openProjectText(text, 'link'));
  openLink.current = (text) => openProjectText(text, 'link');
  useEffect(() => {
    const open = () => {
      if (!location.hash.startsWith(LINK_PREFIX)) return;
      const hash = location.hash;
      history.replaceState(null, '', location.pathname + location.search);
      void openLink.current(
        readStoryLink(hash)
          .then((t) => t ?? Promise.reject(new Error('Not a story link.')))
          .catch(() => Promise.reject(new Error('This story link couldn’t be read. It may have been cut short when it was copied: copy the whole link and try again.'))),
      );
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  return {
    projectFile,
    savedToFile,
    copy,
    openRef,
    markCopied,
    keepBeforeReplacing,
    saveProject,
    chooseProject,
    openProject,
    openProjectText,
    /** The open story is another one now, saved to no file (a new story, or a draft of another): or to `file` when it is one that was. */
    detach: (file: FileHandle | null = null) => {
      setProjectFile(file);
      setSavedToFile(null);
    },
    /** Whether to show the "save a copy" reminder now. */
    reminderDue: () => saveReminderDue({ unsaved, unsavedSince: unsavedSince.current, remindLater, copyAt: copy?.at }),
    remindLater: () => setRemindLater(Date.now() + REMIND_LATER_MS),
  };
}
