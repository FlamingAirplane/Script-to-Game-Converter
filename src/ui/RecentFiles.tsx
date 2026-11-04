import { useEffect, useState } from 'react';
import { when } from './draftStore';
import { canUseFiles, forgetRecent, listRecent, readRecent, type FileHandle, type RecentFile } from './platform';

/** Project files opened or saved recently, to reopen in one click (browsers that can keep files: Chrome, Edge). */
export function RecentFiles({ onOpen }: { onOpen: (file: File, handle: FileHandle) => void }) {
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void listRecent().then((r) => live && setRecent(r));
    return () => {
      live = false;
    };
  }, []);
  if (!canUseFiles() || !recent.length) return null;

  const open = async (r: RecentFile) => {
    setError('');
    try {
      onOpen(await readRecent(r), r.handle);
    } catch (e) {
      setError(`${r.name}: ${e instanceof Error ? e.message : String(e)} If it was moved or renamed, use Open project.`);
    }
  };

  return (
    <section className="drafts" aria-labelledby="recent-head">
      <h2 id="recent-head">Recent project files</h2>
      <ol className="draft-list">
        {recent.map((r) => (
          <li key={`${r.name}-${r.openedAt}`} className="draft">
            <span className="draft-name">{r.title}</span>
            <span className="muted small draft-meta">
              {r.name} · {when(r.openedAt)}
            </span>
            <span className="draft-actions">
              <button className="btn tiny" onClick={() => void open(r)}>
                Open
              </button>
              <button
                className="btn tiny ghost"
                aria-label={`Remove ${r.name} from recent files`}
                onClick={() => void forgetRecent(r.handle).then(() => setRecent(recent.filter((x) => x !== r)))}
              >
                forget
              </button>
            </span>
          </li>
        ))}
      </ol>
      {error && <p className="error-text small">{error}</p>}
    </section>
  );
}
