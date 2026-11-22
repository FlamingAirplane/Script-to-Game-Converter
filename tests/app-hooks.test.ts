import { describe, expect, it } from 'vitest';
import { createHistory, UNDO_LIMIT } from '../src/ui/editHistory';
import { autosaveState, LOW_STORAGE } from '../src/ui/useAutosave';
import { shortcutFor } from '../src/ui/useShortcuts';
import { ago, COPY_FRESH_MS, REMIND_AFTER_MS, saveReminderDue } from '../src/ui/useProjectFiles';

describe('edit history', () => {
  it('steps back and forward through edits, and an edit clears what could be redone', () => {
    const h = createHistory<string>();
    h.record('a', false); // edited a → b
    h.record('b', false); // edited b → c
    expect(h.canUndo()).toBe(true);
    expect(h.takeUndo()).toBe('b');
    h.toRedo('c');
    expect(h.canRedo()).toBe(true);
    expect(h.takeRedo()).toBe('c');
    h.toUndo('b');
    h.takeUndo();
    h.toRedo('c');
    h.record('x', false); // a new edit: nothing to redo
    expect(h.canRedo()).toBe(false);
  });

  it('merges grouped edits into one step, and keeps at most UNDO_LIMIT', () => {
    const h = createHistory<number>();
    h.record(0, false);
    h.record(1, true); // same group: not a new step
    expect(h.takeUndo()).toBe(0);
    expect(h.takeUndo()).toBeUndefined();
    for (let i = 0; i < UNDO_LIMIT + 20; i++) h.record(i, false);
    let n = 0;
    while (h.takeUndo() !== undefined) n++;
    expect(n).toBe(UNDO_LIMIT);
  });

  it('resets when another story opens, and keeps a restore of the same story as one undo step', () => {
    const h = createHistory<string>();
    h.record('a', false);
    h.reset();
    expect(h.canUndo()).toBe(false);
    h.keep('b');
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
  });
});

describe('autosave state', () => {
  it('is failed when nothing was kept, low when the browser is nearly full, else saved', () => {
    expect(autosaveState(false, null)).toBe('failed');
    expect(autosaveState(true, LOW_STORAGE + 0.01)).toBe('low');
    expect(autosaveState(true, 0.2)).toBe('saved');
    expect(autosaveState(true, null)).toBe('saved');
  });
});

describe('shortcuts', () => {
  // A key press as the shortcuts see it (the tests run without a browser, so no real KeyboardEvent).
  const key = (init: Partial<KeyboardEvent> & { key: string }, typing = false) =>
    ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: { closest: () => (typing ? {} : null) }, ...init }) as unknown as KeyboardEvent;
  const ctx = { project: true, tab: 'review' as const, files: true };
  const mod = { ctrlKey: true, metaKey: true }; // one of the two is the platform's modifier; modKey refuses both…
  const meta = { metaKey: true };
  const ctrl = { ctrlKey: true };
  const platform = [meta, ctrl].find((m) => shortcutFor(key({ key: 's', ...m }), ctx)?.do === 'save') ?? meta;

  it('knows the ⌘ shortcuts, and leaves the rest to the browser', () => {
    expect(shortcutFor(key({ key: 'z', ...platform }), ctx)).toEqual({ do: 'undo' });
    expect(shortcutFor(key({ key: 'z', shiftKey: true, ...platform }), ctx)).toEqual({ do: 'redo' });
    expect(shortcutFor(key({ key: '3', ...platform }), ctx)).toEqual({ do: 'tab', n: 3 });
    expect(shortcutFor(key({ key: 's', shiftKey: true, ...platform }), ctx)).toEqual({ do: 'saveAs' });
    expect(shortcutFor(key({ key: 's', shiftKey: true, ...platform }), { ...ctx, files: false })).toBeNull();
    expect(shortcutFor(key({ key: 'f', ...mod }), ctx)).toBeNull(); // ⌘ and Ctrl together is not ours
    expect(shortcutFor(key({ key: 's', ...platform }), { ...ctx, project: false })).toBeNull();
  });

  it('plain keys work only in the right chapter and never while typing', () => {
    expect(shortcutFor(key({ key: 'd' }), ctx)).toEqual({ do: 'dialogueOnly' });
    expect(shortcutFor(key({ key: 'd' }), { ...ctx, tab: 'export' })).toBeNull();
    expect(shortcutFor(key({ key: 'g' }), { ...ctx, tab: 'play' })).toEqual({ do: 'showGated' });
    expect(shortcutFor(key({ key: ']' }), ctx)).toEqual({ do: 'step', dir: 1 });
    expect(shortcutFor(key({ key: '[' }), { ...ctx, tab: 'graph' })).toBeNull();
    expect(shortcutFor(key({ key: 'd' }, true), ctx)).toBeNull();
    expect(shortcutFor(key({ key: '?' }, true), ctx)).toBeNull();
    expect(shortcutFor(key({ key: '?' }), ctx)).toEqual({ do: 'help' });
  });
});

describe('the reminder to save a copy', () => {
  const now = 10_000_000;
  it('waits for unsaved work to last a while, and for a stale or missing copy', () => {
    const base = { unsaved: true, unsavedSince: now - REMIND_AFTER_MS - 1, remindLater: 0, now };
    expect(saveReminderDue(base)).toBe(true);
    expect(saveReminderDue({ ...base, unsaved: false })).toBe(false);
    expect(saveReminderDue({ ...base, unsavedSince: now - 1000 })).toBe(false); // work only just began
    expect(saveReminderDue({ ...base, copyAt: now - 1000 })).toBe(false); // saved a moment ago
    expect(saveReminderDue({ ...base, copyAt: now - COPY_FRESH_MS - 1 })).toBe(true);
    expect(saveReminderDue({ ...base, remindLater: now + 1000 })).toBe(false); // "Later" was pressed
  });

  it('says how long ago in plain words', () => {
    expect(ago(now, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 2 * 3_600_000, now)).toBe('2 h ago');
  });
});
