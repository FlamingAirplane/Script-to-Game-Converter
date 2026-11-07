import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { compareProjects, type LineChange } from '../core/compare';
import type { StoryProject } from '../core/isr';
import { getDraft, when, type Draft } from './draftStore';

// Compares a draft with the story now: passages added, removed or renamed, and the lines and choices
// changed in each, with unchanged lines folded away.

/** Unchanged runs longer than this are folded to their first and last lines. */
const CONTEXT = 1;

function Lines({ lines }: { lines: LineChange[] }) {
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].kind !== 'same') {
      const l = lines[i];
      out.push(
        <li key={i} className={`diff-${l.kind}`}>
          <span className="diff-mark" aria-hidden="true">
            {l.kind === 'added' ? '+' : '−'}
          </span>
          <span className="sr-only">{l.kind === 'added' ? 'Added: ' : 'Removed: '}</span>
          {l.text}
        </li>,
      );
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].kind === 'same') j++;
    const run = lines.slice(i, j);
    const keepStart = i === 0 ? 0 : CONTEXT;
    const keepEnd = j === lines.length ? 0 : CONTEXT;
    if (run.length > keepStart + keepEnd + 1) {
      run.slice(0, keepStart).forEach((l, k) => out.push(<li key={i + k} className="diff-same">{l.text}</li>));
      out.push(
        <li key={`fold${i}`} className="diff-fold muted small">
          … {run.length - keepStart - keepEnd} lines the same
        </li>,
      );
      run.slice(run.length - keepEnd).forEach((l, k) => out.push(<li key={j - keepEnd + k} className="diff-same">{l.text}</li>));
    } else run.forEach((l, k) => out.push(<li key={i + k} className="diff-same">{l.text}</li>));
    i = j;
  }
  return <ol className="diff-lines">{out}</ol>;
}

export function CompareSheet({ draftId, project, onRestore, onClose }: { draftId: number; project: StoryProject; onRestore: (id: number) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  useEffect(() => {
    void getDraft(draftId).then((d) => setDraft(d ?? null), () => setDraft(null));
  }, [draftId]);
  const cmp = useMemo(() => (draft ? compareProjects(draft.project, project) : null), [draft, project]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => new Set(s.has(id) ? [...s].filter((x) => x !== id) : [...s, id]));

  const counts = cmp && {
    added: cmp.passages.filter((p) => p.status === 'added').length,
    removed: cmp.passages.filter((p) => p.status === 'removed').length,
    changed: cmp.passages.filter((p) => p.status === 'changed').length,
  };
  const diffWords = cmp ? cmp.words.after - cmp.words.before : 0;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet card compare-sheet" role="dialog" aria-modal="true" aria-labelledby="compare-title" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row">
          <h2 id="compare-title">{draft ? `“${draft.label}” compared with now` : 'Compare with now'}</h2>
          <span className="spacer" />
          <button className="btn small ghost" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        {draft === undefined && <p className="muted">Reading the draft…</p>}
        {draft === null && <p className="sev-error">This draft couldn’t be read. It may have been deleted.</p>}
        {draft && cmp && counts && (
          <>
            <p className="muted small">
              The draft was kept {when(draft.savedAt)}. Lines marked <span className="diff-added-chip">+</span> are new since then; lines marked{' '}
              <span className="diff-removed-chip">−</span> were in the draft but aren’t now.
            </p>
            <p className="compare-summary" role="status">
              {cmp.passages.length === 0
                ? 'Nothing has changed since this draft.'
                : [
                    counts.changed && `${counts.changed} passage${counts.changed === 1 ? '' : 's'} changed`,
                    counts.added && `${counts.added} added`,
                    counts.removed && `${counts.removed} removed`,
                    `${cmp.unchanged} the same`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
              {diffWords !== 0 && ` · ${diffWords > 0 ? '+' : '−'}${Math.abs(diffWords).toLocaleString()} words (${cmp.words.after.toLocaleString()} now)`}
            </p>
            {(cmp.characters.added.length > 0 || cmp.characters.removed.length > 0 || cmp.startChanged) && (
              <ul className="small compare-notes">
                {cmp.characters.added.length > 0 && <li>New characters: {cmp.characters.added.join(', ')}</li>}
                {cmp.characters.removed.length > 0 && <li>Characters no longer in the story: {cmp.characters.removed.join(', ')}</li>}
                {cmp.startChanged && (
                  <li>
                    The story now starts at “{cmp.startChanged.after}” (it started at “{cmp.startChanged.before}”).
                  </li>
                )}
              </ul>
            )}
            {cmp.passages.length > 0 && (
              <div className="row wrap">
                <button className="btn tiny ghost" onClick={() => setOpen(new Set(cmp.passages.map((p) => p.id + p.status)))}>
                  Open all
                </button>
                <button className="btn tiny ghost" onClick={() => setOpen(new Set())}>
                  Close all
                </button>
              </div>
            )}
            <ol className="compare-list">
              {cmp.passages.map((p) => {
                const key = p.id + p.status;
                const isOpen = open.has(key) || cmp.passages.length <= 3;
                return (
                  <li key={key} className={`compare-passage compare-${p.status}`}>
                    <button className="compare-head" aria-expanded={isOpen} onClick={() => toggle(key)}>
                      <span className="compare-status">{p.status === 'added' ? 'New' : p.status === 'removed' ? 'Removed' : 'Changed'}</span>
                      <span className="compare-title">
                        {p.title}
                        {p.oldTitle && <span className="muted small"> (was “{p.oldTitle}”)</span>}
                      </span>
                      <span className="muted small compare-count">
                        {p.added > 0 && `+${p.added}`} {p.removed > 0 && `−${p.removed}`}
                      </span>
                    </button>
                    {isOpen && (p.added || p.removed ? <Lines lines={p.lines} /> : <p className="muted small diff-only-title">Only its title changed.</p>)}
                  </li>
                );
              })}
            </ol>
            <div className="row">
              <span className="spacer" />
              <button
                className="btn"
                onClick={() => {
                  onClose();
                  onRestore(draft.id);
                }}
              >
                Restore this draft
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
