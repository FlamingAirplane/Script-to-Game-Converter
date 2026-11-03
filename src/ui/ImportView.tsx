import { useRef, useState } from 'react';
import type { SourceInput } from '../core/builder';
import type { ConversionMode } from '../core/isr';
import { BINARY_EXTENSIONS, CONVERTED_EXTENSIONS, prepareInput } from '../core/parsing/convert';
import { SUPPORTED_EXTENSIONS } from '../core/parsing/registry';

const ACCEPTED = [...SUPPORTED_EXTENSIONS, ...CONVERTED_EXTENSIONS];
import { SAMPLES } from '../samples';
import { DraftShelf } from './Drafts';
import { GettingStarted } from './GettingStarted';
import { Logo } from './Logo';

// The hosted site (GitHub Pages) also serves the offline writer edition next to index.html. Hidden in
// development, where that file doesn't exist, and inside the offline edition itself (opened from file://).
const OFFLINE_COPY_AVAILABLE = import.meta.env.PROD && typeof location !== 'undefined' && location.protocol.startsWith('http');

const MODES: { id: ConversionMode; name: string; desc: string }[] = [
  { id: 'faithful', name: 'Faithful conversion', desc: 'Preserve content and order. Scenes become passages; nothing is invented.' },
  { id: 'adaptation', name: 'Interactive adaptation', desc: 'Propose choices and item-gated paths grounded in the text, for your approval.' },
  { id: 'structured', name: 'Structured import', desc: 'Interpret explicit @passage, choice, @item and @var markers.' },
];

export function ImportView({
  onConvert,
  busy,
  onRestoreDraft,
}: {
  onConvert: (inputs: SourceInput[], mode: ConversionMode, title?: string) => void;
  busy: boolean;
  onRestoreDraft: (id: number) => void;
}) {
  const [files, setFiles] = useState<SourceInput[]>([]);
  const [paste, setPaste] = useState('');
  const [pasteName, setPasteName] = useState('script.fountain');
  const [mode, setMode] = useState<ConversionMode>('faithful');
  const [title, setTitle] = useState('');
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setError('');
    const next: SourceInput[] = [];
    const problems: string[] = [];
    for (const f of Array.from(list)) {
      if (/\.(pdf|doc)$/i.test(f.name)) {
        problems.push(`${f.name}: ${/\.doc$/i.test(f.name) ? 'old .doc files can’t be read — re-save it as .docx in Word.' : 'PDF isn’t supported yet — export the script as Final Draft, Word, Fountain or plain text.'}`);
        continue;
      }
      try {
        const binary = BINARY_EXTENSIONS.some((e) => f.name.toLowerCase().endsWith(e));
        next.push(await prepareInput(f.name, binary ? new Uint8Array(await f.arrayBuffer()) : await f.text()));
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (problems.length) setError(problems.join(' '));
    setFiles((cur) => [...cur, ...next]);
  };

  const inputs: SourceInput[] = [...files, ...(paste.trim() ? [{ fileName: pasteName || 'pasted.txt', text: paste }] : [])];

  return (
    <div className="view import-view">
      <section className="hero">
        <div className="title-page">
          <Logo size={58} />
          <p className="edition">The Workshop Edition</p>
          <h1>Narrative Bridge</h1>
          <p className="subtitle">Turn a script into a playable story</p>
          <div className="orn-rule" aria-hidden>
            <span>❦</span>
          </div>
        </div>
        <p className="lede">
          Import a screenplay or structured prose, review what was understood, then export a validated Ink story packaged for Unity or Unreal Engine. Everything runs
          locally in your browser — nothing is uploaded.
        </p>
        {OFFLINE_COPY_AVAILABLE && (
          <p className="offline-note small">
            Prefer to work offline? <a href="./Narrative-Bridge.html" download>Download Narrative Bridge as a single file</a> and double-click it any time ·{' '}
            <a href="./WRITERS.md">guide for writers</a>
          </p>
        )}
        <GettingStarted />
      </section>

      <div className="import-grid">
        <section className="card">
          <h2>1 · Source</h2>
          <div
            className={`dropzone ${drag ? 'drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                input.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
          >
            <strong>Drop files here</strong> or click to browse
            <span className="muted small">Final Draft, Word, Fountain, Markdown, Ink or plain text</span>
            <input ref={input} type="file" multiple hidden accept={[...ACCEPTED, '.text'].join(',')} onChange={(e) => addFiles(e.target.files)} />
          </div>
          {error && <p className="error-text">{error}</p>}
          {files.length > 0 && (
            <ul className="file-list">
              {files.map((f, i) => (
                <li key={i}>
                  <span className="mono">{f.fileName}</span>
                  <span className="muted small">{f.text.split('\n').length} lines</span>
                  <button className="link" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="paste">
            <div className="row">
              <label className="muted small">…or paste text as</label>
              <input className="input mono small" value={pasteName} onChange={(e) => setPasteName(e.target.value)} aria-label="File name for pasted text" />
            </div>
            <textarea className="textarea mono" rows={9} aria-label="Script text" placeholder={'INT. ARCHIVE - NIGHT\n\nMIRA\nThe archive is locked.'} value={paste} onChange={(e) => setPaste(e.target.value)} />
          </div>
        </section>

        <section className="card">
          <h2>2 · Conversion mode</h2>
          <div className="modes">
            {MODES.map((m) => (
              <label key={m.id} className={`mode ${mode === m.id ? 'selected' : ''}`}>
                <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
                <span>
                  <strong>{m.name}</strong>
                  <span className="muted small">{m.desc}</span>
                </span>
              </label>
            ))}
          </div>
          <label className="field">
            <span className="muted small">Story title (optional — read from the title page if present)</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Locked Archive" />
          </label>
          <button className="btn primary big" disabled={!inputs.length || busy} onClick={() => onConvert(inputs, mode, title || undefined)}>
            {busy ? 'Converting…' : `Convert ${inputs.length ? `${inputs.length} file${inputs.length > 1 ? 's' : ''}` : ''}`}
          </button>
        </section>
      </div>

      <section className="samples">
        <h2>Or start from a sample</h2>
        <div className="sample-grid">
          {SAMPLES.map((s) => (
            <button key={s.id} className="sample" disabled={busy} onClick={() => onConvert([{ fileName: s.fileName, text: s.text }], s.mode)}>
              <span className="sample-name">{s.name}</span>
              <span className="muted small">{s.blurb}</span>
              <span className="sample-meta mono small">
                {s.fileName} · {s.mode}
              </span>
            </button>
          ))}
        </div>
      </section>

      <DraftShelf onRestore={onRestoreDraft} />

      <details className="card markers-help">
        <summary>Structured marker reference</summary>
        <pre className="mono small">{`@passage archive_entry Archive Entrance     start a passage (id + optional title)
@start archive_entry                         choose the start passage
@item archive_key "Archive Key" consumable   declare an inventory item
@var trust = 0                               declare a variable (bool / int / "string")
@give archive_key   @take archive_key        item effects
@set trust = 2      @add trust 1             variable effects
* [Choice text] -> target                    once-only choice
+ {has archive_key} [Open it] -> vault @take archive_key
+ {trust >= 2 and not has lamp} [Trust her] -> ally
- [Markdown link choice](#target)
-> target   /   @end                         divert / ending
## Heading {#custom_id}                      Markdown heading as a passage`}</pre>
      </details>

      <p className="colophon-note small">
        Narrative Bridge is free and open source ·{' '}
        <a href="https://github.com/FlamingAirplane/Script-to-Game-Converter" target="_blank" rel="noopener noreferrer">
          View on GitHub
        </a>{' '}
        ·{' '}
        <a href="https://github.com/FlamingAirplane/Script-to-Game-Converter/issues" target="_blank" rel="noopener noreferrer">
          Report a problem
        </a>
      </p>
    </div>
  );
}
