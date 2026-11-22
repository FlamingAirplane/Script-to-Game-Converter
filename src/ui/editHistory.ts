import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { carryTranslations } from '../core/export/translations';
import { ensureIds, withIds } from '../core/ids';
import type { StoryProject } from '../core/isr';
import { editableCopy } from './projectOps';

// Undo and redo for the open project. Each undo step is a whole earlier project (see editableCopy: the source scripts
// are shared between steps, not copied), up to UNDO_LIMIT of them.

export const UNDO_LIMIT = 100;
/** Edits in the same group within this long of each other are one undo step. */
export const MERGE_WINDOW_MS = 2000;

/** The undo and redo stacks, with no React in them. */
export function createHistory<T>(limit = UNDO_LIMIT) {
  let undos: T[] = [];
  let redos: T[] = [];
  return {
    /** An edit is about to replace `cur`: it becomes an undo step (unless it merges into the last one), and redo is gone. */
    record(cur: T, merge: boolean) {
      if (!merge) {
        undos.push(cur);
        if (undos.length > limit) undos.shift();
      }
      redos = [];
    },
    /** Takes the latest undo step off the stack (undefined when there is none); the project it replaces goes to `toRedo`. */
    takeUndo: (): T | undefined => undos.pop(),
    toRedo(cur: T | null | undefined) {
      if (cur) redos.push(cur);
    },
    takeRedo: (): T | undefined => redos.pop(),
    toUndo(cur: T | null | undefined) {
      if (cur) undos.push(cur);
    },
    /** Replacing the open story or loading another: nothing to undo or redo. */
    reset() {
      undos = [];
      redos = [];
    },
    /** Replacing `cur` with another version of the same story, as one undoable step. */
    keep(cur: T) {
      undos.push(cur);
      redos = [];
    },
    canUndo: () => undos.length > 0,
    canRedo: () => redos.length > 0,
  };
}

/**
 * The project's edit history. `update` applies an edit to a copy of the project (edits sharing a `group`, such as
 * keystrokes in one text field, become one undo step); `undo` and `redo` step through the copies.
 */
export function useEditHistory(setProject: Dispatch<SetStateAction<StoryProject | null>>, onEdit: () => void) {
  const history = useRef(createHistory<StoryProject>());
  const lastEdit = useRef<{ group: string; at: number } | null>(null);
  const [, redraw] = useState(0);

  const update = useCallback(
    (fn: (draft: StoryProject) => void, group?: string) => {
      const now = Date.now();
      const merge = !!group && lastEdit.current?.group === group && now - lastEdit.current.at < MERGE_WINDOW_MS;
      lastEdit.current = group ? { group, at: now } : null;
      // React may run an updater twice (in development, to catch side effects): the history is written only once.
      let recorded = false;
      setProject((cur) => {
        if (!cur) return cur;
        const next = editableCopy(cur);
        ensureIds(next); // lines get their ids before the edit changes their words, and again for any the edit adds
        fn(next);
        ensureIds(next);
        if (next.translations) carryTranslations(withIds(cur), next); // reworded lines and choices keep their translations
        if (!recorded) history.current.record(cur, merge);
        recorded = true;
        return next;
      });
      onEdit();
    },
    [setProject, onEdit],
  );

  // The step is taken off the stack here, once; the state update below only swaps the projects over.
  const undo = useCallback(() => {
    lastEdit.current = null;
    const prev = history.current.takeUndo();
    if (!prev) return;
    let moved = false; // see update: an updater may run twice
    setProject((cur) => {
      if (!moved) history.current.toRedo(cur);
      moved = true;
      return prev;
    });
    redraw((n) => n + 1);
  }, [setProject]);

  const redo = useCallback(() => {
    const next = history.current.takeRedo();
    if (!next) return;
    let moved = false;
    setProject((cur) => {
      if (!moved) history.current.toUndo(cur);
      moved = true;
      return next;
    });
    redraw((n) => n + 1);
  }, [setProject]);

  return {
    update,
    undo,
    redo,
    reset: () => history.current.reset(),
    keep: (cur: StoryProject) => history.current.keep(cur),
    canUndo: () => history.current.canUndo(),
    canRedo: () => history.current.canRedo(),
  };
}
