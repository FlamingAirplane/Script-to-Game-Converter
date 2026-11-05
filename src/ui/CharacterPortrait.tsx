import { useRef, useState } from 'react';
import type { Character } from '../core/isr';
import { storeImage } from './audioStore';
import { usePicture } from './pictures';
import type { Update } from './projectOps';

/** Story settings → Characters: the picture shown while this character speaks. Pick a file or drop one here. */
export function CharacterPortrait({ character, update }: { character: Character; update: Update }) {
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const url = usePicture(character.portrait);
  const id = character.id;
  const name = character.displayName;

  const attach = async (f: File) => {
    setBusy(true);
    setError('');
    try {
      const ref = await storeImage(f, f.name, `portrait_${id}`);
      update((d) => {
        const c = d.characters.find((x) => x.id === id);
        if (c) c.portrait = { ...ref, alt: `Portrait of ${c.displayName}` };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`portrait-cell${over ? ' over' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
        if (f) void attach(f);
      }}
    >
      {character.portrait ? (
        <>
          {url ? <img className="portrait-thumb" src={url} alt={`Portrait of ${name}`} /> : <span className="portrait-thumb missing muted" title="This picture isn't in this browser">?</span>}
          <button className="btn tiny" disabled={busy} onClick={() => file.current?.click()} aria-label={`Replace ${name}'s portrait`}>
            Replace…
          </button>
          <button
            className="btn tiny danger"
            aria-label={`Remove ${name}'s portrait`}
            onClick={() =>
              // The picture's bytes stay in the browser, so Undo can bring it back.
              update((d) => {
                const c = d.characters.find((x) => x.id === id);
                if (c) delete c.portrait;
              })
            }
          >
            Remove
          </button>
        </>
      ) : (
        <button className="btn tiny" disabled={busy} onClick={() => file.current?.click()} aria-label={`Add a portrait for ${name}`} title="Shown while they speak, in Playtest, the playable story and Unity. You can also drop a picture here.">
          {busy ? 'Adding…' : '+ Portrait'}
        </button>
      )}
      {error && <span className="error-text small">{error}</span>}
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        aria-label={`Portrait file for ${name}`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void attach(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
