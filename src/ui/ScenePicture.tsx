import { useRef, useState } from 'react';
import type { Passage } from '../core/isr';
import { storeImage } from './audioStore';
import { usePicture } from './pictures';
import type { Update } from './projectOps';

/** Review: the picture shown when this passage (scene) begins. Pick a file or drop one here. */
export function ScenePicture({ passage, update }: { passage: Passage; update: Update }) {
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const image = passage.image;
  const url = usePicture(image);
  const pid = passage.id;

  const attach = async (f: File) => {
    setBusy(true);
    setError('');
    try {
      const ref = await storeImage(f, f.name, pid);
      // Keep the description when a picture is replaced.
      update((d) => {
        const p = d.passages.find((x) => x.id === pid);
        if (p) p.image = { ...ref, ...(p.image?.alt ? { alt: p.image.alt } : {}) };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (f) void attach(f);
  };

  return (
    <section
      className={`scene-picture${over ? ' over' : ''}`}
      aria-labelledby={`pic-${pid}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <h3 id={`pic-${pid}`}>Scene picture</h3>
      {image ? (
        <div className="scene-picture-row">
          {url ? <img className="scene-thumb" src={url} alt="" /> : <span className="scene-thumb missing small muted">not in this browser</span>}
          <div className="scene-picture-info">
            <span className="small" title={image.name}>
              {image.name}
              {image.width ? <span className="muted"> · {image.width} × {image.height}</span> : null}
            </span>
            <label className="field">
              <span className="muted small">Describe it (read aloud to players who can't see it)</span>
              <input
                className="input"
                value={image.alt ?? ''}
                placeholder="e.g. A lighthouse in a storm, its lamp dark"
                onChange={(e) =>
                  update((d) => {
                    const p = d.passages.find((x) => x.id === pid);
                    if (p?.image) p.image.alt = e.target.value;
                  }, `alt:${pid}`)
                }
              />
            </label>
            <div className="row">
              <button className="btn tiny" disabled={busy} onClick={() => file.current?.click()}>
                Replace…
              </button>
              <button
                className="btn tiny danger"
                onClick={() => {
                  // The picture's bytes stay in the browser, so Undo can bring it back.
                  update((d) => {
                    const p = d.passages.find((x) => x.id === pid);
                    if (p) delete p.image;
                  });
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="muted small">
          <button className="btn tiny" disabled={busy} onClick={() => file.current?.click()}>
            {busy ? 'Adding…' : '+ Add a picture'}
          </button>{' '}
          or drop one here. It shows when this scene begins: in Playtest, the playable story and the game.
        </p>
      )}
      {error && <p className="error-text small">{error}</p>}
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        aria-label="Scene picture file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void attach(f);
          e.target.value = '';
        }}
      />
    </section>
  );
}
