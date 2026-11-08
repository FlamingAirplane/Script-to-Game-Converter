import { useEffect, useMemo, useRef, useState } from 'react';
import { pendingSuggestions } from '../core/adapt';
import { isPinnedRef, pascalCase } from '../core/export/common';
import { ADAPTERS, buildPlayableHtml, buildRecordingScript, recordingScriptFileName, buildTwee, ExportBlockedError, playableFileName, twineFileName, unityTarball, unityTarballName, zipExport, type EngineTarget, type ExportResult, type TwineKind } from '../core/export';
import { SEMVER, unityPackageId } from '../core/export/unityPackage';
import { languageName } from './language';
import { importTranslations, removeLanguage, translationCoverage, translationSheet } from '../core/export/translations';
import { normaliseUnityTheme } from '../core/export/unityTheme';
// The engine-only Ink runtime (~125 KB), embedded in playable-story exports.
import inkRuntime from '../../node_modules/inkjs/dist/ink.js?raw';
import { referencedAudio } from '../core/audio';
import { referencedImages } from '../core/images';
import { fileBase, referencedOriginals } from '../core/isr';
import type { ProcessedStory } from '../core/pipeline';
import { collectClips } from './audioStore';
import { renderClips } from './audioRender';
import { sfx } from './sfx';
import { Badge, SeverityIcon, download } from './common';
import type { StoryProject } from '../core/isr';
import type { Update } from './projectOps';
import { UnityThemeEditor } from './UnityThemeEditor';
import { DialogueOnlySetting } from './DialogueOnlySetting';
import { INK_COMPILER } from '../core/version';

const INKJS_VERSION = INK_COMPILER.version;
import { RecordingsImport } from './RecordingsImport';

// `stale`: an edit is still being processed, so exports wait for it rather than packaging the previous version.
export function ExportView({ processed, stale, onState, project, update, onReview }: { processed: ProcessedStory; stale: boolean; onState: (s: 'Exporting' | 'Succeeded' | 'Failed' | null) => void; project: StoryProject; update: Update; onReview?: () => void }) {
  const [engine, setEngine] = useState<EngineTarget>('unity');
  const adapter = ADAPTERS[engine];
  const defaultName = pascalCase(processed.project.project.title) || 'NarrativeProject';
  const [opts, setOpts] = useState({ projectName: defaultName, engineVersion: adapter.defaultEngineVersion, integrationRef: adapter.integration.defaultRef, includeDemo: true, unityLayout: 'package' as 'package' | 'project', packageVersion: '1.0.0', unityAddressables: false });
  const [sheetLanguages, setSheetLanguages] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const [zip, setZip] = useState<Uint8Array | null>(null);
  const [tgz, setTgz] = useState<Uint8Array | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setOpts((o) => ({ ...o, engineVersion: adapter.defaultEngineVersion, integrationRef: adapter.integration.defaultRef }));
    setResult(null);
    setZip(null);
    setTgz(null);
  }, [engine, adapter]);
  useEffect(() => {
    setResult(null);
    setZip(null);
    setTgz(null);
  }, [processed]);

  const blocking = processed.diagnostics.filter((d) => d.exportBlocked);
  const pending = processed.diagnostics.filter((d) => d.severity === 'review');
  const waiting = pendingSuggestions(processed.project);
  const requirements = adapter.requirements({ engine, ...opts });
  const pinned = isPinnedRef(opts.integrationRef);
  const asPackage = engine === 'unity' && opts.unityLayout === 'package';
  const pkgId = unityPackageId(opts.projectName, processed.project.project.title);
  const versionOk = SEMVER.test(opts.packageVersion);

  const build = async () => {
    setBusy(true);
    setError('');
    onState('Exporting');
    try {
      const audio = await renderClips(referencedAudio(processed.project));
      const images = await collectClips(referencedImages(processed.project));
      const originals = await collectClips(referencedOriginals(processed.project));
      const r = await adapter.export(processed, { engine, ...opts, audio, images, originals, translationLanguages: languageList(sheetLanguages) });
      setResult(r);
      setZip(await zipExport(r));
      setTgz(engine === 'unity' && opts.unityLayout === 'package' ? await unityTarball(r) : null);
      setPreview(r.files.find((f) => f.path.endsWith('narrative-bridge.manifest.json'))?.path ?? null);
      onState(r.report.errors.length ? 'Failed' : 'Succeeded');
      if (!r.report.errors.length) sfx.stamp();
      // The result (file list and download) is below the settings: bring it into view.
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
    } catch (e) {
      setError(e instanceof ExportBlockedError ? `Export blocked — ${e.message}` : String(e));
      onState('Failed');
    } finally {
      setBusy(false);
    }
  };

  const tree = useMemo(() => {
    if (!result) return [];
    // Unity's .meta files (one per file and folder) are left out of the list; they're in the download.
    return result.files
      .map((f) => f.path)
      .filter((p) => !p.endsWith('.meta'))
      .sort();
  }, [result]);
  const metas = result ? result.files.length - tree.length : 0;

  return (
    <div className="view export-view">
      <section className={`card export-summary ${blocking.length ? 'blocked' : ''}`} aria-label="Before you export">
        <h2>Before you export</h2>
        <p className="small">
          {blocking.length
            ? `✗ ${blocking.length} error${blocking.length > 1 ? 's' : ''} must be fixed first (see the Diagnostics panel). Every export below waits for this.`
            : '✓ No errors: every export below is ready.'}
          {waiting > 0 && (
            <>
              {' '}
              {waiting} suggestion{waiting > 1 ? 's are' : ' is'} still waiting for your OK and will be left out of every export.{' '}
              {onReview && (
                <button className="btn tiny" onClick={onReview}>
                  Review now
                </button>
              )}
            </>
          )}
        </p>
        <DialogueOnlySetting project={project} update={update} />
      </section>
      <ShareSection processed={processed} stale={stale} project={project} update={update} />

      <h2 className="section-title">For a game engine</h2>
      <section className="engines">
        {(['unity', 'unreal'] as EngineTarget[]).map((e) => (
          <button key={e} className={`engine-card ${engine === e ? 'selected' : ''}`} onClick={() => setEngine(e)}>
            <span className="engine-name">{ADAPTERS[e].label}</span>
            <span className="muted small">via {ADAPTERS[e].integration.name}</span>
            <span className="muted small mono">{ADAPTERS[e].integration.repository.replace('https://github.com/', '').replace('.git', '')}</span>
          </button>
        ))}
      </section>

      <PackageContents engine={engine} layout={opts.unityLayout} />

      <div className="export-grid">
        <section className="card">
          <h2>Package settings</h2>
          {engine === 'unity' && (
            <fieldset className="modes layout-choice">
              <legend className="muted small">What to build</legend>
              <label className={`mode ${opts.unityLayout === 'package' ? 'selected' : ''}`}>
                <input type="radio" name="unity-layout" checked={opts.unityLayout === 'package'} onChange={() => setOpts({ ...opts, unityLayout: 'package' })} />
                <span>
                  <strong>A package for a game you already have</strong>
                  <span className="muted small">Add it to any Unity project with Package Manager (or drop it in Packages/). Nothing in the project is replaced.</span>
                </span>
              </label>
              <label className={`mode ${opts.unityLayout === 'project' ? 'selected' : ''}`}>
                <input type="radio" name="unity-layout" checked={opts.unityLayout === 'project'} onChange={() => setOpts({ ...opts, unityLayout: 'project' })} />
                <span>
                  <strong>A complete new Unity project</strong>
                  <span className="muted small">The same package inside a ready-to-open project, to try the story on its own.</span>
                </span>
              </label>
            </fieldset>
          )}
          <label className="field">
            <span className="muted small">{asPackage ? 'Story name' : 'Project name'}</span>
            <input className="input" value={opts.projectName} onChange={(e) => setOpts({ ...opts, projectName: e.target.value.replace(/[^\p{L}\p{N}_\- ]/gu, '') })} />
            {engine === 'unity' && (
              <span className="muted small">
                Package <code>{pkgId.name}</code> · C# namespace <code>{pkgId.namespace}</code>
              </span>
            )}
          </label>
          {asPackage && (
            <label className="field">
              <span className="muted small">Package version {versionOk ? null : <Badge tone="warning">use numbers like 1.2.0</Badge>}</span>
              <input className={`input mono ${versionOk ? '' : 'invalid'}`} value={opts.packageVersion} onChange={(e) => setOpts({ ...opts, packageVersion: e.target.value.trim() })} />
            </label>
          )}
          <details className="advanced">
            <summary>Advanced: versions{engine === 'unity' ? ' and loading' : ''}</summary>
          <label className="field">
            <span className="muted small">{asPackage ? 'Unity version you build with (the package works in 2022.3 and later)' : `${adapter.label} version`}</span>
            <input className="input mono" value={opts.engineVersion} onChange={(e) => setOpts({ ...opts, engineVersion: e.target.value })} />
          </label>
          <label className="field">
            <span className="muted small">
              {adapter.integration.name} ref (tag or commit) {pinned ? <Badge tone="ok">pinned</Badge> : <Badge tone="warning">branch — not reproducible</Badge>}
            </span>
            <input className="input mono" value={opts.integrationRef} onChange={(e) => setOpts({ ...opts, integrationRef: e.target.value.trim() })} />
          </label>
          {engine === 'unity' && (
            <div className="field">
              <label className="check">
                <input type="checkbox" checked={opts.unityAddressables} onChange={(e) => setOpts({ ...opts, unityAddressables: e.target.checked })} aria-describedby="addressables-help" />
                Load voice clips and pictures on demand (Addressables)
              </label>
              <span className="muted small" id="addressables-help">
                For long or heavily voiced stories: they aren’t all built into the game. The package sets up the Addressables group itself.
              </span>
            </div>
          )}
          <label className="field">
            <span className="muted small">Translation sheet: language columns to add (e.g. fr, de). Every export has the sheet; translators fill the columns in.</span>
            <input className="input mono" value={sheetLanguages} placeholder="e.g. fr, de" onChange={(e) => setSheetLanguages(e.target.value)} />
          </label>
          </details>
          {!asPackage && (
            <label className="check">
              <input type="checkbox" checked={opts.includeDemo} onChange={(e) => setOpts({ ...opts, includeDemo: e.target.checked })} />
              Include runnable demo ({engine === 'unity' ? 'auto-created scene with the story UI' : 'press Play to see the story in its story panel'})
            </label>
          )}

          <h3>Preflight</h3>
          <ul className="checklist">
            <li>
              <Pass ok={processed.compile.ok} /> Ink compiles with pinned inkjs
            </li>
            <li>
              <Pass ok={!blocking.length} /> {blocking.length ? `${blocking.length} blocking error(s)` : 'No blocking errors'}
            </li>
            <li>
              {processed.smokePending ? (
                <>
                  <span className="sev sev-info">…</span> Running automated playthroughs…
                </>
              ) : (
                <>
                  <Pass ok={!!processed.smoke && !processed.smoke.runtimeErrors.length} /> {processed.smoke ? `${processed.smoke.completedRuns}/${processed.smoke.runs} automated playthroughs reached an ending` : 'Story smoke test not run'}
                </>
              )}
            </li>
            {pending.length > 0 && (
              <li>
                <SeverityIcon severity="review" /> {pending.length} proposed change(s) not approved — they will be left out
              </li>
            )}
          </ul>
          <button className="btn primary big" disabled={busy || stale || blocking.length > 0 || !!processed.smokePending || (asPackage && !versionOk)} onClick={build}>
            {busy ? 'Building…' : engine === 'unity' ? (asPackage ? 'Build Unity package' : 'Build Unity project') : `Build ${adapter.label} package`}
          </button>
          {result && zip && !busy && (
            <p className="small built-note" role="status">
              {result.report.errors.length ? '✗ Built, but a check failed: see below.' : `✓ Built: ${tree.length} files, ${(zip.length / 1024).toFixed(1)} KB.`}{' '}
              <button className="link" onClick={() => resultRef.current?.scrollIntoView({ block: 'start' })}>
                Go to the download
              </button>
            </p>
          )}
          {blocking.length > 0 && <p className="error-text small">Fix the errors in the Diagnostics panel to enable export.</p>}
          {error && <p className="error-text">{error}</p>}
        </section>

        <details className="advanced advanced-card">
          <summary>Advanced: the look of the story window in {adapter.label} (colours, fonts, layout and more)</summary>
          <UnityThemeEditor project={project} update={update} engine={engine} />
        </details>

        <section className="card">
          <p className="for-dev small">For your developer</p>
          <h2>What their computer needs</h2>
          <p className="muted small">Writers can skip this. The browser can’t check a computer, so your developer can run <code>npm run cli -- doctor --engine {engine}</code> to check these automatically.</p>
          <ul className="checklist">
            {requirements.map((r) => (
              <li key={r.id}>
                <strong>{r.label}</strong>
                <span className="muted small">{r.detail}</span>
              </li>
            ))}
          </ul>
          {result && (
            <>
              <h3>Next steps</h3>
              <ol className="steps">
                {result.report.setupInstructions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>

      {result && (
        <section className="card result" ref={resultRef} aria-label="The built package">
          <div className="row">
            <h2>{result.rootName}</h2>
            {result.report.errors.length ? <Badge tone="error">a check failed</Badge> : <Badge tone="ok">files checked</Badge>}
            <Badge tone="muted">not yet opened in {adapter.label}</Badge>
            <span className="spacer" />
            <span className="muted small">
              {tree.length} files{metas ? ` (+ ${metas} Unity .meta)` : ''} · {zip ? `${(zip.length / 1024).toFixed(1)} KB` : ''}
            </span>
            {tgz && (
              <button className="btn" title="For Package Manager → + → Install package from tarball…" onClick={() => download(unityTarballName(result), tgz, 'application/gzip')}>
                Download .tgz
              </button>
            )}
            <button className="btn primary" disabled={!zip} onClick={() => zip && download(`${fileBase(processed.project)}-${engine}.zip`, zip, 'application/zip')}>
              Download .zip
            </button>
          </div>
          <p className="muted small">
            Checked here: every file the package needs is in it and the story compiles. It hasn’t been opened or built in {adapter.label}; that happens on your developer’s computer.
          </p>
          {result.report.diagnostics.length > 0 && (
            <ul className="inline-diags">
              {result.report.diagnostics.map((d, i) => (
                <li key={i}>
                  <SeverityIcon severity={d.severity} /> {d.message} {d.remediation && <span className="muted small">— {d.remediation}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="file-browser">
            <ul className="tree mono small">
              {tree.map((p) => (
                <li key={p}>
                  <button className={`link ${preview === p ? 'active' : ''}`} onClick={() => setPreview(p)}>
                    {p}
                  </button>
                </li>
              ))}
            </ul>
            <pre className="file-preview mono small">{preview ? previewText(result.files.find((f) => f.path === preview)?.content) : ''}</pre>
          </div>
        </section>
      )}
    </div>
  );
}

/** Bring a filled-in translation sheet back into the story, and see how much of each language is done. */
function TranslationsIn({ project, update }: { project: StoryProject; update: Update }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const coverage = translationCoverage(project);
  const read = async (file: File) => {
    setError('');
    setMessage('');
    try {
      const text = await file.text();
      // Read it into a copy first: a wrong file changes nothing, and this says what it brings.
      const f = importTranslations(structuredClone(project), text);
      update((d) => void importTranslations(d, text));
      setMessage(
        `Brought in ${f.languages.map((l) => `${languageName(l.code)} (${l.translated} of ${f.total})`).join(', ')}.` +
          (f.stale ? ` ${f.stale} row(s) were for text that has changed since the sheet was made, so they were left out.` : ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="translations-in">
      <label className="btn small file-btn">
        Bring in a translated sheet…
        <input type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => (e.target.files?.[0] && void read(e.target.files[0]), (e.target.value = ''))} />
      </label>
      {coverage.languages.length > 0 && (
        <ul className="small translation-coverage" aria-label="Translations in this story">
          {coverage.languages.map((l) => (
            <li key={l.code}>
              <strong>{languageName(l.code)}</strong> <span className="muted">({l.code})</span>: {l.translated} of {coverage.total} translated
              {l.translated < coverage.total && <span className="muted"> · download the sheet to see what’s missing</span>}{' '}
              <button className="link small" onClick={() => update((d) => removeLanguage(d, l.code))} aria-label={`Remove ${languageName(l.code)}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p className="small" role="status">
          {message} Playtest and the playable story can now show it; the Unity package includes it.
        </p>
      )}
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}

/** "fr, de" → ["fr", "de"]: language codes for the translation sheet's columns. */
function languageList(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(x)))];
}

function Pass({ ok }: { ok: boolean }) {
  return <span className={`sev ${ok ? 'sev-ok' : 'sev-error'}`}>{ok ? '✓' : '●'}</span>;
}

/** Exports that need no game engine: a playable web page for readers, and a Twine project. */
function ShareSection({ processed, stale, project, update }: { processed: ProcessedStory; stale: boolean; project: StoryProject; update: Update }) {
  const [error, setError] = useState('');
  const [twineKind, setTwineKind] = useState<TwineKind>('sugarcube');
  const [languages, setLanguages] = useState('');
  const blocked = processed.diagnostics.some((d) => d.exportBlocked) || stale;
  const run = async (fn: () => void | Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ExportBlockedError ? e.message : String(e));
    }
  };
  return (
    <>
      <h2 className="section-title">Share without a game engine</h2>
      <section className="share-grid">
        <div className="card share-card">
          <h2>Playable story</h2>
          <p className="muted small">
            One web page anyone can open to read and play your story, on a computer or phone. Send it by email or put it online. Readers' progress is saved
            in their browser.
          </p>
          <button
            className="btn primary"
            disabled={blocked}
            onClick={() =>
              run(async () => {
                const audio = await renderClips(referencedAudio(processed.project));
                const images = await collectClips(referencedImages(processed.project));
                download(playableFileName(processed), buildPlayableHtml(processed, inkRuntime, audio, images), 'text/html');
              })
            }
          >
            Download playable story (.html)
          </button>
        </div>
        <div className="card share-card">
          <h2>Recording script</h2>
          <p className="muted small">
            Every line of dialogue in story order, by character, with the file name each recording should be saved as. Opens in Excel, Numbers or
            Google Sheets, ready for a voice session.
          </p>
          <button className="btn" disabled={stale} onClick={() => run(() => download(recordingScriptFileName(processed.project), buildRecordingScript(processed.project), 'text/csv'))}>
            Download recording script (.csv)
          </button>
          <RecordingsImport project={project} update={update} />
        </div>
        <div className="card share-card">
          <h2>Translation sheet</h2>
          <p className="muted small">
            Every line, choice, name and button the player sees, one per row, for translators: add a column per language (for example <code>fr</code> or{' '}
            <code>de</code>) and fill it in. The Unity and Unreal exports show the story in any language the sheet has.
          </p>
          <label className="field">
            <span className="muted small">Language columns to start with (optional)</span>
            <input className="input mono" value={languages} placeholder="e.g. fr, de" onChange={(e) => setLanguages(e.target.value)} aria-label="Language columns to start with" />
          </label>
          <button
            className="btn"
            disabled={stale}
            onClick={() =>
              run(() => download(`${fileBase(processed.project)}-translations.csv`, translationSheet(processed.project, normaliseUnityTheme(processed.project.presentation?.unity), languageList(languages)), 'text/csv'))
            }
          >
            Download translation sheet (.csv)
          </button>
          <TranslationsIn project={project} update={update} />
        </div>
        <div className="card share-card">
          <h2>Twine</h2>
          <p className="muted small">
            A Twine project to keep editing the story visually. In Twine 2, choose <em>Library → Import</em> and pick the file.
          </p>
          <fieldset className="twine-kind">
            <legend className="muted small">What to include</legend>
            <label>
              <input type="radio" name="twine-kind" checked={twineKind === 'sugarcube'} onChange={() => setTwineKind('sugarcube')} />
              <span>
                <strong>Story and game logic</strong>
                <span className="muted small">Choices that need items, effects and a book style, for the SugarCube format.</span>
              </span>
            </label>
            <label>
              <input type="radio" name="twine-kind" checked={twineKind === 'plain'} onChange={() => setTwineKind('plain')} />
              <span>
                <strong>Story only</strong>
                <span className="muted small">Just passages, their text and links. Nothing added, so it works in any Twine format; every choice is always shown.</span>
              </span>
            </label>
          </fieldset>
          <button className="btn" disabled={blocked} onClick={() => run(() => download(twineFileName(processed, twineKind), buildTwee(processed, twineKind)))}>
            Download for Twine (.twee)
          </button>
        </div>
      </section>
      {blocked && !stale && <p className="error-text small">Fix the items marked “must fix” in Diagnostics to enable these downloads.</p>}
      {error && <p className="error-text">{error}</p>}
    </>
  );
}

function previewText(content: string | Uint8Array | undefined): string {
  if (content === undefined) return '';
  if (typeof content === 'string') return content.slice(0, 20000);
  return `(audio file, ${(content.length / 1024).toFixed(1)} KB)`;
}

/** What a developer gets in the .zip, what they still do, and which versions it targets, in plain words. */
function PackageContents({ engine, layout }: { engine: EngineTarget; layout: 'package' | 'project' }) {
  const a = ADAPTERS[engine];
  const unity = engine === 'unity';
  return (
    <details className="card package-contents" open>
      <summary>
        <h2>What your developer gets</h2>
      </summary>
      <div className="contents-grid">
        <div>
          <h3>In the .zip</h3>
          <ul className="small">
            <li>
              <strong>Your story in Ink</strong>, the scripting language for game stories (<code>.ink</code>), checked and compiled, ready to run.
            </li>
            {unity ? (
              <>
                <li>
                  {layout === 'package' ? (
                    <>
                      <strong>A Unity package</strong> they add to the game they already have: nothing in their project is replaced.
                    </>
                  ) : (
                    <>
                      <strong>A complete Unity project</strong> that opens to a demo scene, with the same package inside.
                    </>
                  )}
                </li>
                <li>
                  <strong>Ready-made code</strong> that plays the story: lines, choices, Continue breaks, exits to the game, saves, and items (C#).
                </li>
                <li>
                  <strong>A story panel</strong> styled with the Story UI settings below, which they can change in Unity.
                </li>
              </>
            ) : (
              <>
                <li>
                  <strong>An Unreal project</strong> (C++) set up for the Inkpot plugin, with a script that fetches Inkpot.
                </li>
                <li>
                  <strong>Ready-made code</strong> that plays the story: lines, choices, Continue breaks, exits to the game, saves, items and translations (C++, usable from Blueprints).
                </li>
                <li>
                  <strong>A story panel</strong> styled with the Story UI settings below, and tests that replay every ending.
                </li>
              </>
            )}
            <li>Your recordings, scene pictures and portraits, your original script, and a report of every check that passed.</li>
          </ul>
        </div>
        <div>
          <h3>What they still do</h3>
          <ul className="small">
            {unity ? (
              <>
                <li>Add the package (or open the project) in Unity. It offers to install Ink Unity Integration if the game doesn’t have it.</li>
                <li>Put the story where it belongs in the game (a menu adds it to a scene), and connect it to their gameplay: the README in the package explains how.</li>
                <li>Swap in the game’s own art, fonts and sounds if they want.</li>
              </>
            ) : (
              <>
                <li>Run the setup script (it fetches Inkpot), then open the project in Unreal and let it build.</li>
                <li>Put the story where it belongs in the game (a menu adds it to a level), and connect it to their gameplay: the README explains how.</li>
              </>
            )}
          </ul>
        </div>
        <div>
          <h3>Versions</h3>
          <ul className="small">
            {unity ? (
              <>
                <li>Unity 6 (recommended) or 2022.3 LTS and later</li>
                <li>
                  {a.integration.name} {a.integration.defaultRef}
                </li>
              </>
            ) : (
              <>
                <li>Unreal Engine {a.defaultEngineVersion} or later</li>
                <li>
                  {a.integration.name} {a.integration.defaultRef}, which the setup script fetches (changeable under Advanced)
                </li>
              </>
            )}
            <li>Ink compiled with inkjs {INKJS_VERSION}</li>
          </ul>
        </div>
      </div>
    </details>
  );
}
