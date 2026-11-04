import { useEffect, useRef } from 'react';

// Keyboard shortcuts: shared helpers and the "?" reference card.

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = IS_MAC ? '⌘' : 'Ctrl';

/** True when the key press belongs to a text field (or a contenteditable), so single-key shortcuts must not fire. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t?.closest?.('input, textarea, select, [contenteditable="true"]');
}

/** A plain key press: no Ctrl/⌘/Alt, not in a text field. */
export function plainKey(e: KeyboardEvent): boolean {
  return !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e);
}

/**
 * The app's ⌘ shortcuts (Ctrl on Windows and Linux): exactly ⌘ + key, with ⇧ only where a shortcut
 * uses it (redo). Any other combination (⌘⇧F, ⌘⌥I, Ctrl+F on a Mac…) is left to the browser and the system.
 */
export function modKey(e: KeyboardEvent, { shift = false }: { shift?: boolean } = {}): boolean {
  const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && !e.altKey && (shift || !e.shiftKey);
}

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Anywhere',
    keys: [
      [`${MOD} 1 – 6`, 'Go to chapter I – VI'],
      [`${MOD} S`, 'Save project'],
      [`⇧ ${MOD} S`, 'Save as… (Chrome, Edge)'],
      [`${MOD} O`, 'Open project'],
      [`${MOD} Z  /  ⇧ ${MOD} Z`, 'Undo / redo'],
      [`${MOD} F`, 'Find (passages, text, map)'],
      [`${MOD} .`, 'Show or hide Diagnostics'],
      [`${MOD} L`, 'Open the Logbook'],
      ['?', 'This card'],
    ],
  },
  {
    title: 'Review',
    keys: [
      ['[  /  ]', 'Previous / next passage'],
      ['D', 'Dialogue only (also in Playtest)'],
    ],
  },
  {
    title: 'Playtest',
    keys: [
      ['1 – 9', 'Pick a choice'],
      ['Backspace', 'Undo the last choice'],
      ['R', 'Restart'],
      ['V', 'Voices on / off'],
    ],
  },
  {
    title: 'Graph',
    keys: [
      ['/', 'Find a passage'],
      ['F', 'Fit the map'],
      ['+  /  −', 'Zoom in / out'],
      ['Tab', 'Move between passages'],
      ['Space', "Show a passage's lines"],
      ['Enter', 'Open it in Review'],
      ['Esc', 'Close the passage panel'],
    ],
  },
];

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet card" role="dialog" aria-modal="true" aria-labelledby="keys-title" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 id="keys-title">Keyboard shortcuts</h2>
          <span className="spacer" />
          <button ref={close} className="btn tiny" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="sheet-grid">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.keys.map(([k, what]) => (
                  <div key={k} className="key-row">
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
