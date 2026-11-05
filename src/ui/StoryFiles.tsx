import { useEffect, useMemo, useState } from 'react';
import { storyFiles, zipPaths, type StoryFile, type StoryFileKind } from '../core/files';
import type { StoryProject } from '../core/isr';
import { getClip } from './audioStore';
import { download } from './common';

// Story settings → Files: everything put into this story, to download again. Scripts as text,
// recordings, scene pictures and portraits as the files themselves; or all of them as one zip.

const KIND_LABEL: Record<StoryFileKind, string> = { script: 'Scripts', recording: 'Voice recordings', picture: 'Scene pictures', portrait: 'Character portraits' };
const KINDS: StoryFileKind[] = ['script', 'recording', 'picture', 'portrait'];

function size(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function bytesOf(f: StoryFile): Promise<Uint8Array | string | undefined> {
  if (f.text != null) return f.text;
  return f.id ? (await getClip(f.id))?.bytes : undefined;
}

export function StoryFiles({ project }: { project: StoryProject }) {
  const files = useMemo(() => storyFiles(project), [project]);
  // Which media are in this browser, and how big each file is.
  const [sizes, setSizes] = useState<Map<string, number | null>>(new Map());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const key = files.map((f) => f.id ?? f.fileName).join('|');
  useEffect(() => {
    let live = true;
    void (async () => {
      const next = new Map<string, number | null>();
      for (const f of files) {
        const data = await bytesOf(f);
        next.set(f.id ?? f.fileName, data == null ? null : typeof data === 'string' ? new TextEncoder().encode(data).length : data.length);
      }
      if (live) setSizes(next);
    })();
    return () => {
      live = false;
    };
  }, [key]);

  const one = async (f: StoryFile) => {
    const data = await bytesOf(f);
    if (data == null) return setNote(`${f.fileName} isn’t in this browser. Open the project file it was saved in, then try again.`);
    download(f.fileName, data, f.mime);
  };
  const all = async () => {
    setBusy(true);
    setNote('');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const paths = zipPaths(files);
      let missing = 0;
      for (let i = 0; i < files.length; i++) {
        const data = await bytesOf(files[i]);
        if (data == null) missing++;
        else zip.file(paths[i], data);
      }
      const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const title = project.project.title.replace(/[^\w\- ]+/g, '').trim() || 'story';
      download(`${title} - files.zip`, bytes, 'application/zip');
      if (missing) setNote(`${missing} file${missing === 1 ? ' isn’t' : 's aren’t'} in this browser, so ${missing === 1 ? 'it was' : 'they were'} left out.`);
    } catch (e) {
      setNote(`Couldn’t make the zip: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const total = [...sizes.values()].reduce<number>((n, s) => n + (s ?? 0), 0);
  return (
    <section className="story-files" aria-labelledby="story-files-title">
      <div className="row wrap">
        <h3 id="story-files-title">Files</h3>
        <span className="spacer" />
        <span className="muted small">
          {files.length} file{files.length === 1 ? '' : 's'}
          {total ? ` · ${size(total)}` : ''}
        </span>
        <button className="btn small" disabled={busy || !files.length} onClick={() => void all()}>
          {busy ? 'Zipping…' : 'Download all (.zip)'}
        </button>
      </div>
      <p className="muted small">Everything put into this story, to download again: the scripts it was made from, voice recordings, scene pictures and portraits.</p>
      {note && (
        <p className="small error-text" role="status">
          {note}
        </p>
      )}
      {KINDS.map((k) => {
        const list = files.filter((f) => f.kind === k);
        if (!list.length) return null;
        return (
          <div key={k} className="file-group">
            <h4>
              {KIND_LABEL[k]} <span className="muted small">({list.length})</span>
            </h4>
            <ul className="file-rows">
              {list.map((f) => {
                const s = sizes.get(f.id ?? f.fileName);
                const missing = s === null;
                return (
                  <li key={f.id ?? f.fileName}>
                    <span className="file-name mono small" title={f.fileName}>
                      {f.fileName}
                    </span>
                    <span className="file-context muted small" title={f.context}>
                      {f.context}
                      {f.convertedFrom ? ` (as text; the .${f.convertedFrom} itself isn’t kept)` : ''}
                    </span>
                    <span className="muted small file-size">{missing ? 'not in this browser' : s != null ? size(s) : ''}</span>
                    <button className="btn tiny" disabled={missing} onClick={() => void one(f)} aria-label={`Download ${f.fileName}`}>
                      Download
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {!files.length && <p className="muted small">No files yet.</p>}
    </section>
  );
}
