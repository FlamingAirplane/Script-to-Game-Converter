import { useEffect, useRef } from 'react';
import { canUseFiles } from './platform';
import { isTyping, modKey, plainKey } from './Shortcuts';

// The app's keyboard shortcuts. `shortcutFor` decides what a key press means (no React, easy to test); the hook
// listens for them and calls what the app gave it.

export type ShortcutTab = 'import' | 'review' | 'graph' | 'play' | 'ink' | 'export';

export type Shortcut =
  | { do: 'undo' }
  | { do: 'redo' }
  | { do: 'tab'; n: number }
  | { do: 'save' }
  | { do: 'saveAs' }
  | { do: 'open' }
  | { do: 'find' }
  | { do: 'log' }
  | { do: 'toggleDiagnostics' }
  | { do: 'help' }
  | { do: 'dialogueOnly' }
  | { do: 'showGated' }
  | { do: 'step'; dir: 1 | -1 };

export interface ShortcutContext {
  /** A project is open (most shortcuts need one). */
  project: boolean;
  /** The chapter the writer is in. */
  tab: ShortcutTab;
  /** The browser can save to a file the writer picks. */
  files: boolean;
}

/** What this key press does, or null when it isn't ours (the browser and the system keep it). */
export function shortcutFor(e: KeyboardEvent, ctx: ShortcutContext): Shortcut | null {
  const mod = modKey(e);
  const typing = isTyping(e);
  const k = e.key.toLowerCase();
  if (modKey(e, { shift: true }) && k === 'z' && !typing) return e.shiftKey ? { do: 'redo' } : { do: 'undo' };
  if (mod && /^[1-6]$/.test(e.key) && ctx.project) return { do: 'tab', n: +e.key };
  if (mod && k === 's' && ctx.project) return { do: 'save' };
  if (modKey(e, { shift: true }) && e.shiftKey && k === 's' && ctx.project && ctx.files) return { do: 'saveAs' };
  if (mod && k === 'o') return { do: 'open' };
  if (mod && k === 'f' && ctx.project) return { do: 'find' };
  if (mod && k === 'l') return { do: 'log' };
  if (mod && e.key === '.' && ctx.project) return { do: 'toggleDiagnostics' };
  if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) return { do: 'help' };
  if (k === 'd' && plainKey(e) && (ctx.tab === 'review' || ctx.tab === 'play')) return { do: 'dialogueOnly' };
  if (k === 'g' && plainKey(e) && (ctx.tab === 'play' || ctx.tab === 'graph') && ctx.project) return { do: 'showGated' };
  if ((e.key === '[' || e.key === ']') && plainKey(e) && ctx.tab === 'review' && ctx.project) return { do: 'step', dir: e.key === ']' ? 1 : -1 };
  return null;
}

/** What the app does for each shortcut. */
export interface ShortcutHandlers {
  undo: () => void;
  redo: () => void;
  tab: (n: number) => void;
  save: () => void | Promise<void>;
  saveAs: () => void | Promise<void>;
  open: () => void;
  find: () => void;
  log: () => void;
  toggleDiagnostics: () => void;
  help: () => void;
  dialogueOnly: () => void;
  showGated: () => void;
  step: (dir: 1 | -1) => void;
}

/** Listens for the app's shortcuts. `ctx` and `handlers` may change every render; the listener always sees the latest. */
export function useShortcuts(ctx: Omit<ShortcutContext, 'files'>, handlers: ShortcutHandlers): void {
  const latest = useRef({ ctx, handlers });
  latest.current = { ctx, handlers };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { ctx, handlers } = latest.current;
      const s = shortcutFor(e, { ...ctx, files: canUseFiles() });
      if (!s) return;
      e.preventDefault();
      switch (s.do) {
        case 'tab':
          return handlers.tab(s.n);
        case 'step':
          return handlers.step(s.dir);
        case 'save':
          return void handlers.save();
        case 'saveAs':
          return void handlers.saveAs();
        default:
          return handlers[s.do]();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
