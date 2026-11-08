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
import demoPicture from './assets/demo-playable.jpg';
import { putClip } from './audioStore';
import { designWord, useDesign } from './design/design';

// The hosted site (GitHub Pages) also serves the offline writer edition next to index.html. Hidden in
// development, where that file doesn't exist, and inside the offline edition itself (opened from file://).
const OFFLINE_COPY_AVAILABLE = import.meta.env.PROD && typeof location !== 'undefined' && location.protocol.startsWith('http');

/** The sample the demo picture shows, offered first. */
const FEATURED = SAMPLES.find((s) => s.id === 'lighthouse') ?? SAMPLES[0];

const MODES: { id: ConversionMode; name: string; desc: string; when: string; recommended?: boolean }[] = [
  { id: 'faithful', name: 'Faithful conversion', desc: 'Keeps your story exactly as written: each scene becomes a passage (a page of the story) and nothing is invented.', when: 'Use this when your script is finished and you want it playable as it is.', recommended: true },
  { id: 'adaptation', name: 'Interactive adaptation', desc: 'Also suggests choices, and paths that need an item (like a key), drawn from your text. You accept or reject each one.', when: 'Use this when you want help turning a linear script into one with choices.' },
  { id: 'structured', name: 'Structured import', desc: 'Reads markers you type into the script, like @passage and @item, to build the story exactly as you mark it.', when: 'Use this when you’ve already planned the branches (see the marker reference below).' },
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
const REPO = 'https://github.com/FlamingAirplane/Script-to-Game-Converter';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** “Install as an app” when the browser offers it (Chrome, Edge); otherwise a short how-to. */
function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(
    () => typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true),
  );
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setInstalled(true);
    addEventListener('beforeinstallprompt', onPrompt);
    addEventListener('appinstalled', onInstalled);
    return () => {
      removeEventListener('beforeinstallprompt', onPrompt);
      removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  if (installed || IS_OFFLINE_FILE) return null;
  if (!prompt && SAFARI_TAB) return null; // the Safari note below covers it
  if (prompt)
    return (
      <p className="offline-note small">
        <button
          className="btn small install-btn"
          onClick={async () => {
            await prompt.prompt();
            if ((await prompt.userChoice).outcome === 'accepted') setInstalled(true);
            setPrompt(null);
          }}
        >
          ⤓ Install as an app
        </button>{' '}
        It opens in its own window and works without the internet.
      </p>
    );
  return (
    <p className="offline-note small">
      Works offline once loaded. To keep it like an app: in Chrome or Edge use the install icon in the address bar; in Safari choose <em>File → Add to Dock</em>
      ; on a phone use <em>Share → Add to Home Screen</em>.
    </p>
  );
}

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
        // A Word, PDF, Final Draft or Twine file is kept as it is too, so it can be downloaded again.
        if (prepared.original && prepared.originalBytes) await putClip(prepared.original.id, prepared.original.mime, prepared.originalBytes);
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
        <InstallApp />
        {OFFLINE_COPY_AVAILABLE && (
          <details className="offline-note small">
            <summary>Other ways to work offline</summary>
            <a href="./Narrative-Bridge.html" download>
              Download Narrative Bridge as a single file
            </a>{' '}
            and open it in your web browser any time (if double-clicking shows text, drag the file onto a browser window instead) ·{' '}
            <a href="./WRITERS.md">guide for writers</a>
          </details>
        )}
        {SAFARI_TAB && (
          <p className="offline-note small">
            Using Safari? Choose <em>File → Add to Dock</em> and open Narrative Bridge from the Dock: Safari then keeps your work, instead of clearing it after a week
            without a visit.
          </p>
        )}
      </section>

      {/* A demo first: try a sample in one click, and see what you get. */}
      <section className="try-first" aria-labelledby="try-title">
        <div className="try-copy">
          <h2 id="try-title">Try it with a sample</h2>
          <p className="small">One click turns a short script into a story you can play here, then package for a game engine.</p>
          <button className="btn primary big try-main" disabled={busy} onClick={() => onConvert([{ fileName: FEATURED.fileName, text: FEATURED.text }], FEATURED.mode)}>
            ▶ Try “{FEATURED.name}”
          </button>
          <div className="try-more">
            <span className="muted small">or</span>
            {SAMPLES.filter((x) => x !== FEATURED).map((s) => (
              <button key={s.id} className="btn small" disabled={busy} onClick={() => onConvert([{ fileName: s.fileName, text: s.text }], s.mode)} title={s.blurb}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <figure className="try-demo">
          <img src={demoPicture} alt="A finished story: a screenplay shown as a book page, with the choices Take the brass key and Leave it" width={1000} height={760} />
          <figcaption className="muted small">What you get: your script as a playable story, with choices.</figcaption>
        </figure>
      </section>

      {/* Exactly what comes out, so the promise matches the tool (the Export tab has the full details). */}
      <section className="exports-overview" aria-labelledby="exports-title">
        <h2 id="exports-title">What you can export</h2>
        <ul className="exports-list">
          <li>
            <strong>A web page to share</strong>
            <span className="small">One .html file anyone can play in a browser, even offline. Nothing to install.</span>
          </li>
          <li>
            <strong>For Unity (a .zip)</strong>
            <span className="small">
              Your story in Ink, compiled; a Unity package with ready-made C# that plays it and a styled story panel; your recordings and pictures. For Unity 6
              or 2022.3 and later, with Ink Unity Integration 2.0.0.
            </span>
          </li>
          <li>
            <strong>For Unreal (a .zip)</strong>
            <span className="small">
              Your story in Ink, plus a C++ project for Unreal Engine 5.7 or later, set up for the free Inkpot plugin (a pinned release), with a script that
              fetches it.
            </span>
          </li>
          <li>
            <strong>Text and data</strong>
            <span className="small">The Ink script on its own (.ink, or compiled .json), a Twine story to keep editing, and a recording script for voice actors: a spreadsheet (CSV) of every line.</span>
          </li>
        </ul>
        <p className="muted small">
          It’s not a finished game: a developer adds the package to a game, places the story and connects it to the gameplay. The Export tab lists exactly what
          they still do.
        </p>
      </section>

      <GettingStarted />

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
            <textarea className="textarea mono" rows={9} aria-label="Script text" placeholder={'For example:\n\nINT. ARCHIVE - NIGHT\n\nMIRA\nThe archive is locked.'} value={paste} onChange={(e) => setPaste(e.target.value)} />
          </div>
        </section>

        <section className="card">
          <h2 id="mode-heading">2 · Conversion mode</h2>
          <div className="modes" role="radiogroup" aria-labelledby="mode-heading">
            {MODES.map((m) => (
              <label key={m.id} className={`mode ${mode === m.id ? 'selected' : ''}`}>
                <input type="radio" name="mode" value={m.id} aria-label={m.recommended ? `${m.name} (recommended)` : m.name} aria-describedby={`mode-desc-${m.id}`} checked={mode === m.id} onChange={() => setMode(m.id)} />
                <span id={`mode-desc-${m.id}`}>
                  <strong>
                    {m.name} {m.recommended && <span className="badge badge-ok">recommended</span>}
                  </strong>
                  <span className="muted small">{m.desc}</span>
                  <span className="small mode-when">{m.when}</span>
                </span>
              </label>
            ))}
          </div>
          <label className="field">
            <span className="muted small">Story title (optional — read from the title page if present)</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Locked Archive" />
          </label>
          <button className="btn primary big" disabled={!inputs.length || busy} aria-describedby={!inputs.length ? 'convert-hint' : undefined} onClick={() => onConvert(inputs, mode, title || undefined)}>
            {busy ? 'Converting…' : `Convert ${inputs.length ? `${inputs.length} file${inputs.length > 1 ? 's' : ''}` : ''}`}
          </button>
          {!inputs.length && !busy && (
            <p className="muted small convert-hint" id="convert-hint">
              Add a file or paste a script in step 1 to convert it, or try a sample above.
            </p>
          )}
        </section>
      </div>

      <section className="samples">
        <h2>All the samples</h2>
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
        <summary>What imports well, and known limits</summary>
        <ul className="small limits">
          <li>
            <strong>Best:</strong> Fountain or a plain-text screenplay export, and Markdown prose. Final Draft (.fdx) and Word (.docx) convert well.
          </li>
          <li>
            <strong>PDF</strong> is the hardest: the app guesses scenes, speakers and dialogue from the page layout. Check the result in Review (the
            Diagnostics list on the right points out anything it wasn’t sure of), or export a text version from your writing app instead.
          </li>
          <li>
            <strong>Formatting:</strong> italics, bold and underlining are kept (except from PDFs); fonts, dual dialogue and revision marks aren’t. Old .doc
            files can’t be read: save them as .docx.
          </li>
          <li>
            <strong>Size:</strong> there’s no fixed limit, since everything stays on your computer; very long scripts (hundreds of pages) work but take a few
            seconds more.
          </li>
          <li>
            <strong>Words used here:</strong> a <em>passage</em> is one page or scene of the story; <em>Ink</em> is the scripting language games read;{' '}
            <em>Fountain</em> is a plain-text screenplay format; <em>Diagnostics</em> are the notes about anything to check; <em>markers</em> like{' '}
            <code>@passage</code> are optional tags for planning branches yourself.
          </li>
        </ul>
      </details>

      <details className="card markers-help">
        <summary>Structured marker reference (optional tags for planning branches)</summary>
        <pre className="mono small">{`@passage archive_entry Archive Entrance     start a passage (id + optional title)
@start archive_entry                         choose the start passage
@item archive_key "Archive Key" consumable   declare an inventory item
@var trust = 0                               declare a variable (bool / int / "string")
@give archive_key   @take archive_key        item effects
@set trust = 2      @add trust 1             variable effects
* [Choice text] -> target                    once-only choice
+ {has archive_key} [Open it] -> vault @take archive_key
+ {has archive_key} [Use the key] -> vault @forced   once they have the key, the only choice
+ {trust >= 2 and not has lamp} [Trust her] -> ally
- [Markdown link choice](#target)
-> target   /   @end                         divert / ending
@pause                                       Continue break: the player clicks Continue to read on
@cutscene                                    the passage is a cutscene: only its dialogue, playing by itself
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
        <br />
        <a href="./about.html">About &amp; FAQ</a> · <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">MIT licence</a> ·{' '}
        <a href={`${REPO}/blob/main/CHANGELOG.md`} target="_blank" rel="noopener noreferrer">
          What’s new
        </a>{' '}
        · <a href="./about.html#limits">Known limits</a> · <a href="./about.html#roadmap">Roadmap</a>
      </p>
    </div>
  );
}
