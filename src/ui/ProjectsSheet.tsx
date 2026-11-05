import { useEffect, useState } from 'react';
import type { Diagnostic } from '../core/diagnostics';
import type { StoryProject } from '../core/isr';
import { cloudIdOf, listCloudProjects, loadFromCloud, saveToCloud, type CloudProject } from './cloud';
import { keepToken, savedToken } from './design/live';
import { packProject } from './projectFile';

// "Your projects on other browsers": a project moves as one complete file (no account), or through the
// cloud: a private GitHub Gist per project, listed and opened from any browser with your token.

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function ProjectsSheet({
  project,
  parseDiagnostics,
  onSaveFile,
  onOpenFile,
  onOpenCloud,
  onCloudSaved,
  onClose,
}: {
  project: StoryProject | null;
  parseDiagnostics: Diagnostic[];
  onSaveFile: () => void;
  onOpenFile: () => void;
  onOpenCloud: (text: Promise<string>) => void;
  onCloudSaved?: () => void;
  onClose: () => void;
}) {
  const [token, setToken] = useState(savedToken);
  const [remember, setRemember] = useState(() => {
    try {
      return !!localStorage.getItem('narrative-bridge.github-token');
    } catch {
      return false;
    }
  });
  const [list, setList] = useState<CloudProject[] | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const linked = project ? cloudIdOf(project.project.id) : undefined;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    setNote('');
    try {
      keepToken(token.trim(), remember);
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  const refresh = () => run('Looking…', async () => setList(await listCloudProjects(token.trim())));
  useEffect(() => {
    if (token.trim()) void refresh();
    // only when the sheet opens
  }, []);

  const save = () =>
    run('Saving…', async () => {
      if (!project) return;
      const { json, missing } = await packProject(project, parseDiagnostics);
      const r = await saveToCloud(token.trim(), json, project.project.title, project.project.id);
      onCloudSaved?.();
      setNote(`${r.created ? 'Saved to the cloud for the first time' : 'Saved to the cloud'} (${Math.max(1, Math.round(json.length / 1024))} KB).${missing ? ` ${missing} file(s) weren't in this browser, so they were left out.` : ''} Open it from any browser with your token.`);
      setList(await listCloudProjects(token.trim()));
    });

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet card projects-sheet" role="dialog" aria-modal="true" aria-labelledby="projects-title" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row">
          <h2 id="projects-title">Your project on other browsers</h2>
          <span className="spacer" />
          <button className="btn small ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted small">
          Your work is kept in this browser as you go. To carry on in another browser or on another computer, take the project with you as a file, or keep it in
          the cloud.
        </p>

        <section className="projects-way">
          <h3>As a file (no account)</h3>
          <p className="small">
            One file holds the whole project: the story, recordings, recording sessions, pictures, portraits, the original scripts, and the Unity settings. Open
            it in any browser with <strong>Open project</strong>.
          </p>
          <div className="row wrap">
            <button className="btn" disabled={!project} onClick={onSaveFile}>
              Save the project file…
            </button>
            <button className="btn" onClick={onOpenFile}>
              Open a project file…
            </button>
          </div>
        </section>

        <section className="projects-way">
          <h3>In the cloud (your GitHub account)</h3>
          <p className="small">
            Each project is saved as a <strong>private</strong> Gist in your GitHub account; any browser with your token lists them and opens one. Use a token
            (classic) with only the <code>gist</code> scope: github.com → Settings → Developer settings → Personal access tokens. It stays in this browser and is
            sent only to GitHub.
          </p>
          <label className="field">
            <span className="muted small">GitHub token</span>
            <input className="input mono" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_…" aria-label="GitHub token" />
          </label>
          <label className="check small">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember it in this browser (otherwise until this tab closes)
          </label>
          <div className="row wrap">
            <button className="btn primary" disabled={!project || !token.trim() || !!busy} onClick={() => void save()}>
              {busy === 'Saving…' ? 'Saving…' : linked ? 'Save to the cloud' : 'Save this project to the cloud'}
            </button>
            <button className="btn" disabled={!token.trim() || !!busy} onClick={() => void refresh()}>
              {busy === 'Looking…' ? 'Looking…' : 'Show my cloud projects'}
            </button>
            {token && (
              <button
                className="btn ghost"
                onClick={() => {
                  keepToken('', false);
                  setToken('');
                  setList(null);
                  setNote('Token forgotten in this browser.');
                }}
              >
                Forget the token
              </button>
            )}
          </div>
          {note && (
            <p className="small note-text" role="status">
              {note}
            </p>
          )}
          {error && (
            <p className="small error-text" role="alert">
              {error}
            </p>
          )}
          {list && (
            <ul className="cloud-list">
              {list.map((c) => (
                <li key={c.gistId}>
                  <span className="cloud-title">
                    {c.title}
                    {project && c.projectId === project.project.id && <span className="badge badge-ok">open now</span>}
                  </span>
                  <span className="muted small">saved {when(c.updatedAt)}</span>
                  <a className="small" href={c.url} target="_blank" rel="noreferrer">
                    on GitHub
                  </a>
                  <button
                    className="btn tiny"
                    disabled={!!busy}
                    onClick={() => {
                      keepToken(token.trim(), remember);
                      onOpenCloud(loadFromCloud(token.trim(), c.gistId));
                      onClose();
                    }}
                  >
                    Open
                  </button>
                </li>
              ))}
              {!list.length && <li className="muted small">No projects in the cloud yet. Save one above.</li>}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
