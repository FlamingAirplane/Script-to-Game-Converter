import { useEffect, useRef, useState } from 'react';
import type { SourceInput } from '../core/builder';
import type { ConversionMode } from '../core/isr';
import { BINARY_EXTENSIONS, CONVERTED_EXTENSIONS, prepareInput } from '../core/parsing/convert';
import { inkUnsupported, type InkFeature } from '../core/parsing/ink';
import { SUPPORTED_EXTENSIONS } from '../core/parsing/registry';

const ACCEPTED = [...SUPPORTED_EXTENSIONS, ...CONVERTED_EXTENSIONS];
import { SAMPLES } from '../samples';
import { GENERATOR_VERSION } from '../core/version';
import { DraftShelf } from './Drafts';
import type { FileHandle } from './platform';
import { RecentFiles } from './RecentFiles';
import { GettingStarted, USER_GUIDE_URL } from './GettingStarted';
import { Logo } from './Logo';
import { designWord, useDesign } from './design/design';

// The hosted site (GitHub Pages) also serves the offline writer edition next to index.html. Hidden in
// development, where that file doesn't exist, and inside the offline edition itself (opened from file://).
const OFFLINE_COPY_AVAILABLE = import.meta.env.PROD && typeof location !== 'undefined' && location.protocol.startsWith('http');

const MODES: { id: ConversionMode; name: string; desc: string }[] = [
  { id: 'faithful', name: 'Faithful conversion', desc: 'Preserve content and order. Scenes become passages; nothing is invented.' },
  { id: 'adaptation', name: 'Interactive adaptation', desc: 'Propose choices and item-gated paths grounded in the text, for your approval.' },
  { id: 'structured', name: 'Structured import', desc: 'Interpret explicit @passage, choice, @item and @var markers.' },
];

/** "tunnels, gathers (lines 4, 9)…": the kinds of Ink the editor can't show, briefly. */
function inkSummary(features: InkFeature[]): string {
  const kinds = new Map<string, number[]>();
  for (const f of features) {
    const k = f.feature.replace(/ \(.*$|\s\{.*$/, '');
    kinds.set(k, [...(kinds.get(k) ?? []), f.line]);
  }
  const list = [...kinds].slice(0, 3).map(([k, lines]) => `${k}, line${lines.length === 1 ? '' : 's'} ${lines.slice(0, 3).join(', ')}${lines.length > 3 ? '…' : ''}`);
  return list.join('; ') + (kinds.size > 3 ? `; and ${kinds.size - 3} more` : '');
}

/** Running as the single offline file (opened from disk), which doesn't update itself. */
const IS_OFFLINE_FILE = typeof location !== 'undefined' && location.protocol === 'file:';

/** Safari in a normal tab (not added to the Dock): its storage is cleared after 7 days without a visit. */
const SAFARI_TAB =
  typeof navigator !== 'undefined' &&
  /Apple/.test(navigator.vendor) &&
  !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent) &&
  location.protocol.startsWith('http') &&
  !window.matchMedia?.('(display-mode: standalone)').matches &&
  !(navigator as { standalone?: boolean }).standalone;

const RELEASES = 'https://github.com/FlamingAirplane/Script-to-Game-Converter/releases/latest';

/** "1.2.10" > "1.2.9" */
function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** The offline file can't update itself: on request (and only then), ask GitHub for the latest version. */
function VersionCheck() {
  const [state, setState] = useState<{ status: 'idle' | 'checking' | 'latest' | 'newer' | 'error'; version?: string }>({ status: 'idle' });
  const check = async () => {
    setState({ status: 'checking' });
    try {
      const r = await fetch('https://api.github.com/repos/FlamingAirplane/Script-to-Game-Converter/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
      const tag = String(((await r.json()) as { tag_name?: string }).tag_name ?? '').replace(/^v/, '');
      if (!r.ok || !tag) throw new Error(`GitHub answered ${r.status}`);
      setState(newer(tag, GENERATOR_VERSION) ? { status: 'newer', version: tag } : { status: 'latest' });
    } catch {
      setState({ status: 'error' });
    }
  };
  if (state.status === 'newer')
    return (
      <a href={RELEASES} target="_blank" rel="noopener noreferrer">
        Version {state.version} is available — download it
      </a>
    );
  if (state.status === 'latest') return <span>you have the latest version</span>;
  if (state.status === 'error')
    return (
      <a href={RELEASES} target="_blank" rel="noopener noreferrer">
        couldn’t check (offline?) — see the releases page
      </a>
    );
  return (
    <button className="link small" onClick={() => void check()} disabled={state.status === 'checking'}>
      {state.status === 'checking' ? 'checking…' : 'check for a newer version'}
    </button>
  );
}

export function ImportView({
  onConvert,
  busy,
  onRestoreDraft,
  onOpenProject,
  incoming,
}: {
  onConvert: (inputs: SourceInput[], mode: ConversionMode, title?: string) => void;
  busy: boolean;
  onRestoreDraft: (id: number) => void;
  /** Reopens a recent project file. */
  onOpenProject: (file: File, handle: FileHandle) => void;
  /** Files the system asked the installed app to open (scripts land in the file list). */
  incoming?: File[];
}) {
  const design = useDesign().design;
  const words = { edition: designWord(design, 'edition'), heroTitle: designWord(design, 'heroTitle'), subtitle: designWord(design, 'subtitle'), lede: designWord(design, 'lede') };
  // Ink files carry how to import them, and what in them the editor can't show.
  const [files, setFiles] = useState<(SourceInput & { inkFeatures?: InkFeature[] })[]>([]);
  const [paste, setPaste] = useState('');
  const [pasteName, setPasteName] = useState('script.fountain');
  const [mode, setMode] = useState<ConversionMode>('faithful');
  const [title, setTitle] = useState('');
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | File[] | null) => {
    if (!list) return;
    setError('');
    const next: (SourceInput & { inkFeatures?: InkFeature[] })[] = [];
    const problems: string[] = [];
    for (const f of Array.from(list)) {
      if (/\.doc$/i.test(f.name)) {
        problems.push(`${f.name}: old .doc files can’t be read — re-save it as .docx in Word.`);
        continue;
      }
      try {
        const binary = BINARY_EXTENSIONS.some((e) => f.name.toLowerCase().endsWith(e));
        const prepared = await prepareInput(f.name, binary ? new Uint8Array(await f.arrayBuffer()) : await f.text());
        if (/\.ink$/i.test(f.name)) {
          const inkFeatures = inkUnsupported(prepared.text);
          next.push({ ...prepared, inkFeatures, inkMode: inkFeatures.length ? 'keep' : 'edit' });
        } else next.push(prepared);
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (problems.length) setError(problems.join(' '));
    setFiles((cur) => [...cur, ...next]);
  };

  // Files opened from the system (double-click, "Open with") are added once.
  useEffect(() => {
    if (incoming?.length) void addFiles(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  const inputs: SourceInput[] = [...files.map(({ inkFeatures: _, ...f }) => f), ...(paste.trim() ? [{ fileName: pasteName || 'pasted.txt', text: paste }] : [])];

  return (
    <div className="view import-view">
      <section className="hero">
        <div className="title-page">
          <Logo size={58} />
          <p className="edition">{words.edition}</p>
          <h1>{words.heroTitle}</h1>
          <p className="subtitle">{words.subtitle}</p>
          <div className="orn-rule" aria-hidden>
            <span>❦</span>
          </div>
        </div>
        <p className="lede">{words.lede}</p>
        {OFFLINE_COPY_AVAILABLE && (
          <p className="offline-note small">
            Prefer to work offline? <a href="./Narrative-Bridge.html" download>Download Narrative Bridge as a single file</a> and double-click it any time (if it
            opens as text, right-click it → <em>Open With</em> → your web browser) · <a href="./WRITERS.md">guide for writers</a>
          </p>
        )}
        {SAFARI_TAB && (
          <p className="offline-note small">
            Using Safari? Choose <em>File → Add to Dock</em> and open Narrative Bridge from the Dock: Safari then keeps your work, instead of clearing it after a week
            without a visit.
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
            <span className="muted small">Final Draft, Word, PDF, Fountain, Markdown or plain text — or a Twine or Ink story to keep working on</span>
            <input ref={input} type="file" multiple hidden accept={[...ACCEPTED, '.text'].join(',')} onChange={(e) => addFiles(e.target.files)} />
          </div>
          {error && <p className="error-text">{error}</p>}
          {files.length > 0 && (
            <ul className="file-list">
              {files.map((f, i) => (
                <li key={i}>
                  <span className="mono">{f.fileName}</span>
                  <span className="muted small">{f.convertedFrom === 'twine' || /\.(twee|tw)$/i.test(f.fileName) ? 'Twine story · ' : /\.ink$/i.test(f.fileName) ? 'Ink story · ' : ''}{f.text.split('\n').length} lines</span>
                  <button className="link" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    remove
                  </button>
                  {f.inkFeatures && (
                    <div className="ink-mode">
                      <select
                        className="input tiny-select"
                        aria-label={`How to import ${f.fileName}`}
                        value={f.inkMode}
                        onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, inkMode: e.target.value as 'edit' | 'keep' } : x)))}
                      >
                        <option value="edit">Edit in Narrative Bridge</option>
                        <option value="keep">Keep the Ink exactly as written</option>
                      </select>
                      <span className="muted small">
                        {f.inkFeatures.length === 0
                          ? 'Everything in it can be edited here.'
                          : f.inkMode === 'keep'
                            ? `Kept as written because it uses Ink the editor can’t show (${inkSummary(f.inkFeatures)}). It plays and exports as before, but edits in Review won’t change it.`
                            : `Editable, but ${f.inkFeatures.length} line${f.inkFeatures.length === 1 ? '' : 's'} (${inkSummary(f.inkFeatures)}) will be kept as notes and stop working in play.`}
                      </span>
                    </div>
                  )}
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

      <RecentFiles onOpen={onOpenProject} />
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
@pause                                       Continue break: the player clicks Continue to read on
@exit wolf_fight The player fights wolves    exit to the game: the dialogue stops while the game plays
## Heading {#custom_id}                      Markdown heading as a passage`}</pre>
      </details>

      <p className="colophon-note small">
        Narrative Bridge {GENERATOR_VERSION} is free and open source · {IS_OFFLINE_FILE && <VersionCheck />}
        {IS_OFFLINE_FILE && ' · '}
        <a href={USER_GUIDE_URL} target="_blank" rel="noopener noreferrer">
          User guide
        </a>{' '}
        ·{' '}
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
