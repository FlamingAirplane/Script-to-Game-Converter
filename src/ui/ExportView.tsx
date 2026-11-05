import { useEffect, useMemo, useState } from 'react';
import { isPinnedRef } from '../core/export/common';
import { ADAPTERS, buildPlayableHtml, buildRecordingScript, recordingScriptFileName, buildTwee, ExportBlockedError, playableFileName, twineFileName, unityTarball, unityTarballName, zipExport, type EngineTarget, type ExportResult, type TwineKind } from '../core/export';
import { SEMVER, unityPackageId } from '../core/export/unityPackage';
// The engine-only Ink runtime (~125 KB), embedded in playable-story exports.
import inkRuntime from '../../node_modules/inkjs/dist/ink.js?raw';
import { referencedAudio } from '../core/audio';
import { referencedImages } from '../core/images';
import { referencedOriginals } from '../core/isr';
import type { ProcessedStory } from '../core/pipeline';
import { collectClips } from './audioStore';
import { sfx } from './sfx';
import { Badge, SeverityIcon, download } from './common';
import type { StoryProject } from '../core/isr';
import type { Update } from './projectOps';
import { UnityThemeEditor } from './UnityThemeEditor';
import { RecordingsImport } from './RecordingsImport';

// `stale`: an edit is still being processed, so exports wait for it rather than packaging the previous version.
export function ExportView({ processed, stale, onState, project, update }: { processed: ProcessedStory; stale: boolean; onState: (s: 'Exporting' | 'Succeeded' | 'Failed' | null) => void; project: StoryProject; update: Update }) {
  const [engine, setEngine] = useState<EngineTarget>('unity');
  const adapter = ADAPTERS[engine];
  const defaultName = processed.project.project.title.replace(/[^\w]+/g, '') || 'NarrativeProject';
  const [opts, setOpts] = useState({ projectName: defaultName, engineVersion: adapter.defaultEngineVersion, integrationRef: adapter.integration.defaultRef, includeDemo: true, unityLayout: 'package' as 'package' | 'project', packageVersion: '1.0.0' });
  const [result, setResult] = useState<ExportResult | null>(null);
  const [zip, setZip] = useState<Uint8Array | null>(null);
  const [tgz, setTgz] = useState<Uint8Array | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

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
      const audio = await collectClips(referencedAudio(processed.project));
      const images = await collectClips(referencedImages(processed.project));
      const originals = await collectClips(referencedOriginals(processed.project));
      const r = await adapter.export(processed, { engine, ...opts, audio, images, originals });
      setResult(r);
      setZip(await zipExport(r));
      setTgz(engine === 'unity' && opts.unityLayout === 'package' ? await unityTarball(r) : null);
      setPreview(r.files.find((f) => f.path.endsWith('narrative-bridge.manifest.json'))?.path ?? null);
      onState(r.report.errors.length ? 'Failed' : 'Succeeded');
      if (!r.report.errors.length) sfx.stamp();
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
            <input className="input" value={opts.projectName} onChange={(e) => setOpts({ ...opts, projectName: e.target.value.replace(/[^\w\- ]/g, '') })} />
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
          <label className="field">
            <span className="muted small">{asPackage ? 'Oldest Unity version to support' : `${adapter.label} version`}</span>
            <input className="input mono" value={opts.engineVersion} onChange={(e) => setOpts({ ...opts, engineVersion: e.target.value })} />
          </label>
          <label className="field">
            <span className="muted small">
              {adapter.integration.name} ref (tag or commit) {pinned ? <Badge tone="ok">pinned</Badge> : <Badge tone="warning">branch — not reproducible</Badge>}
            </span>
            <input className="input mono" value={opts.integrationRef} onChange={(e) => setOpts({ ...opts, integrationRef: e.target.value.trim() })} />
          </label>
          {!asPackage && (
            <label className="check">
              <input type="checkbox" checked={opts.includeDemo} onChange={(e) => setOpts({ ...opts, includeDemo: e.target.checked })} />
              Include runnable demo ({engine === 'unity' ? 'auto-created scene with the story UI' : 'Blueprint-friendly C++ component'})
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
          {blocking.length > 0 && <p className="error-text small">Fix the errors in the Diagnostics panel to enable export.</p>}
          {error && <p className="error-text">{error}</p>}
        </section>

        {engine === 'unity' && <UnityThemeEditor project={project} update={update} />}

        <section className="card">
          <h2>Environment requirements</h2>
          <p className="muted small">The browser cannot inspect your machine. Run <code>npm run cli -- doctor --engine {engine}</code> to check these automatically.</p>
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
        <section className="card result">
          <div className="row">
            <h2>{result.rootName}</h2>
            {result.report.errors.length ? <Badge tone="error">verification failed</Badge> : <Badge tone="ok">package verified</Badge>}
            <Badge tone="muted">engine import: pending</Badge>
            <span className="spacer" />
            <span className="muted small">
              {tree.length} files{metas ? ` (+ ${metas} Unity .meta)` : ''} · {zip ? `${(zip.length / 1024).toFixed(1)} KB` : ''}
            </span>
            {tgz && (
              <button className="btn" title="For Package Manager → + → Install package from tarball…" onClick={() => download(unityTarballName(result), tgz, 'application/gzip')}>
                Download .tgz
              </button>
            )}
            <button className="btn primary" disabled={!zip} onClick={() => zip && download(result.unityPackage && engine === 'unity' && result.rootName === result.unityPackage.name ? `${result.rootName}.zip` : `${result.rootName}-${engine}.zip`, zip, 'application/zip')}>
              Download .zip
            </button>
          </div>
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

function Pass({ ok }: { ok: boolean }) {
  return <span className={`sev ${ok ? 'sev-ok' : 'sev-error'}`}>{ok ? '✓' : '●'}</span>;
}

/** Exports that need no game engine: a playable web page for readers, and a Twine project. */
function ShareSection({ processed, stale, project, update }: { processed: ProcessedStory; stale: boolean; project: StoryProject; update: Update }) {
  const [error, setError] = useState('');
  const [twineKind, setTwineKind] = useState<TwineKind>('sugarcube');
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
                const audio = await collectClips(referencedAudio(processed.project));
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
