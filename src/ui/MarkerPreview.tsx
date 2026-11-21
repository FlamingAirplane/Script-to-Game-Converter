import { useEffect, useState, type RefObject } from 'react';
import { analyze } from '../core/analyzer';
import { buildStory } from '../core/builder';
import { conditionInWords } from '../core/gating';
import type { StoryProject } from '../core/isr';
import { friendly } from './friendly';

/** Markers a writer can drop into the paste box with one click: learning the tags by seeing what they do. */
export const MARKER_SNIPPETS: { label: string; title: string; text: string }[] = [
  { label: '@passage', title: 'Start a new passage (a scene or page of the story)', text: '@passage new_scene New Scene' },
  { label: '+ choice', title: 'A choice the player clicks, and where it leads', text: '+ [What the player clicks] -> new_scene' },
  { label: '-> go on', title: 'When this passage is done, go on to another', text: '-> new_scene' },
  { label: '@item', title: 'Declare something the player can carry, like a key', text: '@item key "Key"' },
  { label: '@give', title: 'The player gets the item here', text: '@give key' },
  { label: '+ {locked}', title: 'A choice that needs an item', text: '+ {has key} [Unlock the door] -> new_scene' },
  { label: '@end', title: 'This passage is an ending', text: '@end' },
];

/** Puts a marker on its own line at the cursor in the paste box, and returns the new text. */
export function insertMarker(text: string, at: number, snippet: string): { text: string; cursor: number } {
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before === '' || before.endsWith('\n') ? '' : '\n';
  const trail = after.startsWith('\n') ? '' : '\n';
  const inserted = `${lead}${snippet}${trail}`;
  return { text: before + inserted + after, cursor: before.length + lead.length + snippet.length };
}

/** The toolbar of markers above the paste box. */
export function MarkerToolbar({ textarea, value, onChange }: { textarea: RefObject<HTMLTextAreaElement | null>; value: string; onChange: (v: string) => void }) {
  return (
    <div className="marker-toolbar" role="toolbar" aria-label="Insert a marker">
      <span className="muted small">Insert:</span>
      {MARKER_SNIPPETS.map((s) => (
        <button
          key={s.label}
          type="button"
          className="btn tiny mono"
          title={s.title}
          onClick={() => {
            const el = textarea.current;
            const at = el ? el.selectionEnd : value.length;
            const next = insertMarker(value, at, s.text);
            onChange(next.text);
            requestAnimationFrame(() => {
              if (!el) return;
              el.focus();
              el.setSelectionRange(next.cursor, next.cursor);
            });
          }}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

interface Preview {
  project: StoryProject;
  problems: string[];
}

/** Past this many characters the preview waits for the writer to ask, so typing in a whole novel stays quick. */
export const PREVIEW_LIMIT = 60_000;

/** A live outline of the story the pasted script makes in Structured mode, updating as the writer types. */
export function MarkerPreview({ text, fileName }: { text: string; fileName: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  // For a long script, the text the writer last asked to preview (it updates by itself again once they ask).
  const [asked, setAsked] = useState(false);
  const long = text.length > PREVIEW_LIMIT;
  useEffect(() => {
    if (!text.trim() || (long && !asked)) return setPreview(null);
    let live = true;
    const t = setTimeout(async () => {
      try {
        const { project, diagnostics } = await buildStory([{ fileName: fileName || 'pasted.txt', text }], { mode: 'structured' });
        if (!live) return;
        const all = [...diagnostics, ...analyze(project).diagnostics];
        const problems = [...new Set(all.filter((d) => d.severity === 'error' || d.severity === 'warning').map((d) => friendly(d, project).title))].slice(0, 4);
        setPreview({ project, problems });
      } catch {
        if (live) setPreview(null);
      }
    }, long ? 900 : 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, fileName, long, asked]);

  if (long && !asked)
    return (
      <p className="marker-preview small muted">
        This script is long, so the preview waits until you ask.{' '}
        <button type="button" className="link small" onClick={() => setAsked(true)}>
          Show the preview
        </button>
      </p>
    );
  if (!preview) return null;
  const { project, problems } = preview;
  const title = (id: string) => (id === 'END' ? 'the end' : (project.passages.find((p) => p.id === id)?.title ?? `“${id}” (not written yet)`));
  const choices = project.passages.reduce((n, p) => n + p.choices.length, 0);
  return (
    <section className="marker-preview" aria-live="polite" aria-label="Story preview">
      <p className="small">
        <strong>Preview</strong>{' '}
        <span className="muted">
          {project.passages.length} passage{project.passages.length === 1 ? '' : 's'} · {choices} choice{choices === 1 ? '' : 's'}
          {project.items.length ? ` · ${project.items.length} item${project.items.length === 1 ? '' : 's'}` : ''} — updates as you type
        </span>
      </p>
      <ol className="marker-outline">
        {project.passages.slice(0, 30).map((p) => (
          <li key={p.id}>
            <span className="serif">{p.title}</span>
            {p.id === project.project.startPassage && <span className="muted small"> · start</span>}
            <ul>
              {p.choices.map((c) => (
                <li key={c.id} className="small">
                  {c.conditions.length ? '🔒 ' : '▸ '}[{c.text}] → {title(c.target)}
                  {c.conditions.length > 0 && <span className="muted"> (only if {c.conditions.map((x) => conditionInWords(x, project)).join(' and ')})</span>}
                </li>
              ))}
              {p.divert && <li className="small muted">→ goes on to {title(p.divert)}</li>}
              {p.isEnding && !p.choices.length && <li className="small muted">■ ends here</li>}
            </ul>
          </li>
        ))}
        {project.passages.length > 30 && <li className="muted small">…and {project.passages.length - 30} more</li>}
      </ol>
      {problems.length > 0 && (
        <ul className="marker-problems small">
          {problems.map((m) => (
            <li key={m}>⚠ {m}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
