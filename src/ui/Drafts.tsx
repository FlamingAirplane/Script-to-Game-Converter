import { useEffect, useState } from 'react';
import { deleteDraft, listDrafts, onDraftsChanged, when, type DraftSummary } from './draftStore';

function useDrafts(): DraftSummary[] | null {
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void listDrafts().then((d) => live && setDrafts(d));
    load();
    const off = onDraftsChanged(load);
    return () => {
      live = false;
      off();
    };
  }, []);
  return drafts;
}

/**
 * A shelf of drafts kept in this browser. With `projectId`, only that story's drafts and a way to
 * keep a new one; without it, the newest draft of every story (to reopen earlier work).
 */
export function DraftShelf({ projectId, onKeep, onRestore }: { projectId?: string; onKeep?: (label: string) => Promise<void>; onRestore: (id: number) => void }) {
  const all = useDrafts();
  const [label, setLabel] = useState('');
  const [keeping, setKeeping] = useState(false);
  const [error, setError] = useState('');
  if (!all) return null;
  const drafts = projectId ? all.filter((d) => d.projectId === projectId) : all.filter((d, i) => all.findIndex((x) => x.projectId === d.projectId) === i).slice(0, 6);
  if (!projectId && !drafts.length) return null;

  const keep = async () => {
    if (!onKeep) return;
    setKeeping(true);
    setError('');
    try {
      await onKeep(label.trim() || 'Draft');
      setLabel('');
    } catch {
      setError('This browser has no room for another draft. Delete an old one or use Save project.');
    } finally {
      setKeeping(false);
    }
  };

  return (
    <section className="drafts" aria-labelledby={projectId ? 'drafts-head' : 'earlier-head'}>
      {projectId ? (
        <>
          <h3 id="drafts-head">Drafts</h3>
          <p className="muted small">Keep a copy before a big change and come back to it any time. Drafts stay in this browser; a draft is also kept automatically before this story is replaced.</p>
          <div className="row draft-keep">
            <input className="input" placeholder="Name this draft (e.g. before the rewrite)" value={label} aria-label="Draft name" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void keep()} />
            <button className="btn" disabled={keeping} onClick={() => void keep()}>
              {keeping ? 'Keeping…' : 'Keep a draft'}
            </button>
          </div>
          {error && <p className="small sev-error">{error}</p>}
        </>
      ) : (
        <h2 id="earlier-head">Or pick up earlier work</h2>
      )}
      {drafts.length > 0 && (
        <ol className="draft-list">
          {drafts.map((d) => (
            <li key={d.id} className="draft">
              <span className="draft-name">
                {projectId ? d.label : d.title}
                {d.auto && <span className="muted small"> · kept automatically</span>}
              </span>
              <span className="muted small draft-meta">
                {!projectId && `${d.label} · `}
                {when(d.savedAt)} · {d.passages} passages · {d.words.toLocaleString()} words
              </span>
              <span className="draft-actions">
                <button className="btn tiny" onClick={() => onRestore(d.id)}>
                  {projectId ? 'Restore' : 'Open'}
                </button>
                {projectId && (
                  <button
                    className="btn tiny ghost"
                    aria-label={`Delete draft ${d.label}`}
                    onClick={() => confirm(`Delete the draft “${d.label}”? This can’t be undone.`) && void deleteDraft(d.id)}
                  >
                    delete
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
